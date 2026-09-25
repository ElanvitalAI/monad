import { describe, expect, test } from 'bun:test';
import { assessTrajectoryDrift, isBotOwnedTrajectory } from './browser-act-drift.js';

const ok = (landingVerdict = 'exact') => ({ captureOutcome: 'ok', landingVerdict });

describe('assessTrajectoryDrift', () => {
  test('부류가 그대로면 stable — 그리고 «몇 개로» 말했는지 낸다', () => {
    const r = assessTrajectoryDrift([ok(), ok(), ok()]);
    expect(r.verdict).toBe('stable');
    expect(r.samples).toBe(3);
    expect(r.detail).toContain('표본 3');
  });

  /** ⭐ 이 시험이 요지다 — 이 자는 «눈 회귀»를 실제로 잡았을 것이다. */
  test('⭐ 되던 화면이 «안 되면» degraded — 32차의 그 회귀가 이 꼴이었다', () => {
    const r = assessTrajectoryDrift([ok(), ok(), { captureOutcome: 'timeout', landingVerdict: 'exact' }]);
    expect(r.verdict).toBe('degraded');
    expect(r.detail).toContain('timeout');
  });

  test('처음부터 «안 되던» 것은 degraded 가 아니다 — 나빠진 게 아니다', () => {
    const bad = { captureOutcome: 'timeout', landingVerdict: 'exact' };
    expect(assessTrajectoryDrift([bad, bad, bad]).verdict).toBe('stable');
  });

  test('⛔ 착지 «부류»가 바뀌면 잡는다 — target=_blank 로 바뀌는 것 같은 일', () => {
    const r = assessTrajectoryDrift([ok('exact'), ok('exact'), ok('did-not-move')]);
    expect(r.verdict).toBe('verdict-changed');
    expect(r.detail).toContain('exact');
    expect(r.detail).toContain('did-not-move');
  });

  /**
   * ⛔⭐ 📏 실측(2026-08-28): HN 기사 링크는 첫 화면이 바뀌면 ***착지 호스트가 달라진다***.
   *    그래도 부류는 exact 그대로다 ⇒ 이 자는 «내용 변화»를 회귀로 읽지 «않는다».
   */
  test('⛔ 내용이 바뀌어 «호스트»가 달라져도 부류가 같으면 stable 이다', () => {
    // 이 자는 호스트를 «아예 안 본다» — 그것이 설계다.
    expect(assessTrajectoryDrift([ok('exact'), ok('exact'), ok('exact')]).verdict).toBe('stable');
  });

  test('⛔ 회차가 하나면 «못 쟀다» — 「안 갈렸다」가 아니다', () => {
    const r = assessTrajectoryDrift([ok()]);
    expect(r.verdict).toBe('unmeasured');
    expect(r.detail).toContain('회귀를 말할 수 없다');
  });

  test('⛔ 비어도 «못 쟀다»', () => {
    expect(assessTrajectoryDrift([]).verdict).toBe('unmeasured');
  });

  test('⛔ 화면 판정이 «없는» 회차가 섞이면 못 쟀다고 한다 — 지어내지 않는다', () => {
    expect(assessTrajectoryDrift([{ landingVerdict: 'exact' }, ok()]).verdict).toBe('unmeasured');
    expect(assessTrajectoryDrift([ok(), { landingVerdict: 'exact' }]).verdict).toBe('unmeasured');
  });

  test('착지 부류가 «없는» 옛 회차는 그 축을 건너뛴다 — 화면 축은 그대로 본다', () => {
    const r = assessTrajectoryDrift([{ captureOutcome: 'ok' }, { captureOutcome: 'ok' }]);
    expect(r.verdict).toBe('stable');
  });

  test('⛔ 화면 «악화»가 부류 변화보다 «먼저» 말해진다 — 둘 다면 더 나쁜 것을 낸다', () => {
    const r = assessTrajectoryDrift([ok('exact'), { captureOutcome: 'error', landingVerdict: 'cross-host' }]);
    expect(r.verdict).toBe('degraded');
  });

  test('같은 입력에 «같은 답» — 동률에서도 흔들리지 않는다', () => {
    const steps = [ok('exact'), ok('same-host'), ok('exact')];
    const a = assessTrajectoryDrift(steps).verdict;
    for (let i = 0; i < 5; i += 1) expect(assessTrajectoryDrift(steps).verdict).toBe(a);
  });
});

describe('isBotOwnedTrajectory (2026-08-28)', () => {
  // 🚨 이 함수가 없던 동안 카나리아의 회귀 검사는 ***자기 시험을 자기 회귀로 읽었다*** —
  //    `?/#t` 의 정체는 `instance: test:monad-agent` 의 시험 서버 클릭이었다.
  const known = new Set(['newsbot', 'investor']);

  test('그 봇의 것만 받는다', () => {
    expect(isBotOwnedTrajectory('newsbot', known)).toBe(true);
    expect(isBotOwnedTrajectory('investor', known)).toBe(true);
  });

  test('⛔ personaId 가 «없으면» 「모르는 봇」이 아니라 ***「봇이 아니다」***로 읽는다', () => {
    // 봇의 조작은 언제나 --persona 를 달고 온다 — 안 달렸으면 봇이 한 것이 아니다.
    expect(isBotOwnedTrajectory(null, known)).toBe(false);
    expect(isBotOwnedTrajectory(undefined, known)).toBe(false);
    expect(isBotOwnedTrajectory('', known)).toBe(false);
    expect(isBotOwnedTrajectory('   ', known)).toBe(false);
  });

  test('⛔ 이 카나리아가 «안 보는» 봇도 뺀다 — 남의 궤적으로 내 회귀를 판정하지 않는다', () => {
    expect(isBotOwnedTrajectory('someone-else', known)).toBe(false);
  });

  test('앞뒤 공백은 떼고 견준다', () => {
    expect(isBotOwnedTrajectory('  newsbot  ', known)).toBe(true);
  });
});
