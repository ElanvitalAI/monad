import { describe, expect, it, afterEach } from 'bun:test';
import { pidLiveness, isPidAlive, setPidLivenessObserver, type PidLiveness } from './pid-liveness.js';

/** ⛔ 종전 열 곳이 쓰던 판 — 이 시험의 «반증 대상»이다. 고치면 이 함수와 결과가 갈려야 한다. */
function legacyIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

afterEach(() => setPidLivenessObserver(null));

describe('pidLiveness', () => {
  it('자기 자신은 alive', () => {
    expect(pidLiveness(process.pid)).toBe('alive');
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('없는 pid 는 dead', () => {
    // ⛔ 큰 수를 쓴다 — 재사용될 수 있는 작은 pid 를 쓰면 시험이 «간헐»이 된다.
    expect(pidLiveness(0x7ffffff)).toBe('dead');
    expect(isPidAlive(0x7ffffff)).toBe(false);
  });

  it('⛔ 음수는 «프로세스 그룹»이라 탐침 대상이 아니다 — dead 로 잘라 낸다', () => {
    expect(pidLiveness(-1)).toBe('dead');
    expect(pidLiveness(0)).toBe('dead');
    expect(pidLiveness(1.5)).toBe('dead');
  });

  it('⭐⭐ 종전 판과 «갈린다» — 살아 있지만 내 것이 아닌 pid', () => {
    // 📏 이 기계의 알려진 양성: pid 1(launchd·root). 실제로 «존재»한다.
    //   ⛔ 이 시험이 이 축의 전부다 — 갈리지 않으면 고칠 이유가 없었다는 뜻이다.
    const uid = (process as NodeJS.Process & { getuid?: () => number }).getuid?.();
    if (uid === 0 || uid === undefined) return;   // root·win32 에서는 EPERM 이 안 난다
    const v: PidLiveness = pidLiveness(1);
    if (v === 'alive') return;                     // 플랫폼이 pid 1 을 막지 않으면 이 축은 여기서 못 잰다
    expect(v).toBe('alive-not-mine');
    expect(isPidAlive(1)).toBe(true);
    // 🔑 반증: 종전 판은 «같은 pid» 를 죽었다고 말한다
    expect(legacyIsAlive(1)).toBe(false);
  });

  it('alive-not-mine 일 때만 관측이 난다 — ⛔ 조용히 지나가지 않는다', () => {
    const seen: Array<{ pid: number; liveness: string }> = [];
    setPidLivenessObserver((e) => seen.push({ pid: e.pid, liveness: e.liveness }));
    pidLiveness(process.pid);        // alive   → 관측 없음
    pidLiveness(0x7ffffff);          // dead    → 관측 없음
    expect(seen).toHaveLength(0);
    const uid = (process as NodeJS.Process & { getuid?: () => number }).getuid?.();
    if (uid === 0 || uid === undefined) return;
    if (pidLiveness(1) !== 'alive-not-mine') return;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ pid: 1, liveness: 'alive-not-mine' });
  });

  it('관측기는 null 로 «되돌아간다» — 누수하지 않는다', () => {
    let n = 0;
    setPidLivenessObserver(() => { n += 1; });
    setPidLivenessObserver(null);
    const uid = (process as NodeJS.Process & { getuid?: () => number }).getuid?.();
    if (uid !== 0 && uid !== undefined) pidLiveness(1);
    expect(n).toBe(0);
  });
});
