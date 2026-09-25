import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  formatPartitionSummary, formatSweepNotRun, formatSweepReport, partitionOrphanTests, SWEEP_RUN_FLAG, tallySweep,
  type PreviousSweep, type SweepSnapshot,
} from './orphan-test-sweep.js';

const snapshot = (red: number, extra: Partial<SweepSnapshot['counts']> = {}, dark = 86, loadAverage = 3): SweepSnapshot => {
  const counts = { green: dark - red, red, timeout: 0, unrun: 0, ...extra };
  return { at: '2026-08-25T00:00:00.000Z', dark, counts, loadAverage };
};

describe('partitionOrphanTests', () => {
  it('고아를 «게이트가 이름은 아는 것»과 «어두운 것»으로 가른다', () => {
    const result = partitionOrphanTests(
      ['src/a.test.ts', 'test/flat.test.ts', 'test/dark.test.ts'],
      ['src/a.test.ts'],
      ['test/flat.test.ts'],
    );
    expect(result).toEqual({ reachable: 1, gateNamed: ['test/flat.test.ts'], dark: ['test/dark.test.ts'] });
  });

  // ⛔ 이 저장소가 반복해 데인 「못 잰 0」 — 색인 실패를 「고아 없음」으로 접으면
  //    전수가 «조용히» 아무것도 안 보고 초록으로 보인다.
  it('색인이 없으면 «빈 목록»이 아니라 lookup 실패로 말한다', () => {
    const result = partitionOrphanTests(['test/x.test.ts'], [], null);
    expect(result).toEqual({ indexUnavailable: 'importer test index could not be built' });
    expect(formatPartitionSummary(result)).toBe('orphan tests: lookup failed (importer test index could not be built)');
  });

  // ⛔⭐⭐ 이 자는 «세 수»를 내는데 ***도는 것은 dark 하나뿐***이다.
  //   🚨 2026-08-26(30차) 실측: 내가 «내 자»의 세 수를 「셋 다 훑었다」로 읽고
  //      「관문 사이에 빈 칸이 있다」는 ***과한 결론***을 냈다가 거뒀다(CLAUDE.md 가 이미 못 박은 설계였다).
  //   ⇒ 🩹 그래서 문면이 ***「무엇을 도는가」⊕「무엇을 «안» 보는가」***를 말해야 한다.
  //   ⛔ 이 시험이 없으면 다음 편집이 그 문구를 «조용히» 지운다(내 변경도 시험 없이 통과했다).
  it('요약은 「이 자가 도는 것」과 「안 보는 것」을 «둘 다» 말한다', () => {
    const line = formatPartitionSummary({ dark: ['a.test.ts'], gateNamed: ['b.test.ts', 'c.test.ts'], reachable: 5 });
    expect(line).toContain('dark=1');
    // ⓐ 「이 자가 도는 것」이 dark 임을 «붙여» 말한다
    expect(line).toMatch(/dark=1\(이 자가 [«"]?돈다/);
    // ⓑ 나머지 둘을 «안 본다»고 말한다 — 수만 나란히 내면 「셋 다 훑었다」로 읽힌다
    expect(line).toContain('gate-named=2');
    expect(line).toContain('reachable=5');
    expect(line).toContain('안 본다');
    // ⓒ ⛔ 「안 본다」를 「아무도 안 본다」로 읽지 않게 «누구의 몫인지»를 댄다
    expect(line).toContain('self gate');
    expect(line).toContain('사람 게이트');
  });
});

describe('tallySweep', () => {
  it('행(timeout)을 빨강과 «다른 값»으로 센다', () => {
    expect(tallySweep(['green', 'red', 'timeout', 'timeout', 'unrun'])).toEqual({ green: 1, red: 1, timeout: 2, unrun: 1 });
  });
});

describe('formatSweepReport — 🅣 계약 「수 ⊕ 어제 값」', () => {
  it('어제와 같으면 = 로, 늘면 +N 으로 말한다', () => {
    const previous: PreviousSweep = { kind: 'present', snapshot: snapshot(4) };
    expect(formatSweepReport(snapshot(4), previous)).toBe('orphan sweep: dark=86 red=4 (어제 red=4 =) timeout=0 unrun=0 load=3.0');
    expect(formatSweepReport(snapshot(7), previous)).toContain('red=7 (어제 red=4 +3)');
    expect(formatSweepReport(snapshot(2), previous)).toContain('red=2 (어제 red=4 -2)');
  });

  // ⛔⭐ 넘버원 계약 — 어제 값의 부재를 0 으로 접으면 «첫 관측»이 「0 → 4 급증」으로 읽힌다.
  it('어제 값이 «없으면» 0 이 아니라 「없음」이라고 말한다', () => {
    const report = formatSweepReport(snapshot(4), { kind: 'absent', reason: 'no-history' });
    expect(report).toContain('어제 값 없음 — 첫 관측');
    expect(report).not.toContain('어제 red=0');
  });

  it('「못 읽음」과 「없음」을 다른 문면으로 가른다 — 사람이 고칠 대상이 다르다', () => {
    expect(formatSweepReport(snapshot(4), { kind: 'absent', reason: 'unreadable' })).toContain('어제 값 «못 읽음»');
  });

  // ⛔⭐ dark 86→120 인데 red 가 그대로면 「어제와 같다」로 읽힌다 — 34개가 «새로» 어두워졌는데도.
  it('분모(dark)가 움직였으면 그것도 말한다', () => {
    const previous: PreviousSweep = { kind: 'present', snapshot: snapshot(4, {}, 86) };
    const report = formatSweepReport(snapshot(4, {}, 120), previous);
    expect(report).toContain('dark=120 (어제 dark=86 +34)');
  });

  it('분모가 안 움직였으면 조용하다 — 안 그러면 신호가 묻힌다', () => {
    const previous: PreviousSweep = { kind: 'present', snapshot: snapshot(4) };
    expect(formatSweepReport(snapshot(4), previous)).toBe('orphan sweep: dark=86 red=4 (어제 red=4 =) timeout=0 unrun=0 load=3.0');
  });

  // ⛔⭐ 부하 57 에서 잰 timeout 은 「그 시험이 느리다」가 아니라 「그때 기계가 바빴다」다.
  //   ⇒ 도구가 «스스로» 그 경고를 내야 한다 — 사람이 로드를 따로 기억할 리 없다.
  it('행이 있는데 부하가 어제와 «비교 불가»면 경고한다', () => {
    const previous: PreviousSweep = { kind: 'present', snapshot: snapshot(4, {}, 86, 3) };
    const report = formatSweepReport(snapshot(4, { timeout: 5 }, 86, 57), previous);
    expect(report).toContain('load=57.0');
    expect(report).toContain('비교 불가');
  });

  it('부하가 비슷하면 조용하다 — 안 그러면 경고가 배경음이 된다', () => {
    const previous: PreviousSweep = { kind: 'present', snapshot: snapshot(4, {}, 86, 3) };
    expect(formatSweepReport(snapshot(4, { timeout: 5 }, 86, 4), previous)).not.toContain('비교 불가');
  });

  it('부하를 «못 읽었으면» 0 이 아니라 「못 읽음」이라고 말한다', () => {
    const bare: SweepSnapshot = { at: '2026-08-25T00:00:00.000Z', dark: 86, counts: { green: 82, red: 4, timeout: 0, unrun: 0 } };
    const report = formatSweepReport(bare, { kind: 'absent', reason: 'no-history' });
    expect(report).toContain('load=«못 읽음»');
    expect(report).not.toContain('load=0');
  });

  it('행이 있으면 그 수를 따로 낸다', () => {
    expect(formatSweepReport(snapshot(4, { timeout: 2 }), { kind: 'absent', reason: 'no-history' })).toContain('timeout=2');
  });
});

describe('formatSweepNotRun', () => {
  // ⛔ 「안 돌렸다」를 「red=0」 으로 쓰지 않는다 — 미측정은 초록이 아니다.
  it('전수를 안 돌렸으면 red 를 «미측정»으로 말한다', () => {
    const line = formatSweepNotRun(86);
    expect(line).toContain('red=«미측정»');
    expect(line).not.toContain('red=0');
    expect(line).toContain(SWEEP_RUN_FLAG);
  });

  // ⛔⭐ 라이브 1판이 없는 플래그(`--sweep-run`)를 안내했다 — 안내한 이름이 «실제로 등록»돼
  //   있는지를 기계가 문다. 안 물면 사람이 그 이름을 치고 실패한다.
  it('안내하는 플래그가 실제 CLI 에 «등록»돼 있다', () => {
    const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const command = entry.slice(entry.indexOf("command('orphan-sweep')"));
    expect(command.slice(0, 1200)).toContain(`.option('${SWEEP_RUN_FLAG}'`);
  });
});
