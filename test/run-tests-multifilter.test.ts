// ── run_tests multi-filter tool + integrity-gate OH8 transplant (PR-1) ──
//
// 발단: `bun test <filter>` 는 substring 필터라 오타 필터가 0개 파일을 매칭해도 exit 0 으로
// 거짓 통과("33 pass/exit 0"). 실측: 매칭+오타 필터를 한 번에 돌리면 오타가 조용히 흡수돼
// 어느 필터가 미매칭인지 구분 불가 → run_tests 는 필터마다 개별 실행해 unmatchedFilters 로 잡는다.

import { describe, it, expect } from 'bun:test';
import {
  runTestsMultiFilter,
  aggregateFilterRuns,
  filterMatched,
  type TestSpawn,
} from '../src/skills/tools/run-tests.js';
import { parseTestOutput } from '../src/agent-mission/parse.js';
import { runIntegrityGate, type RunCmd } from '../src/autopilot/build/integrity-gate.js';

// 실제 `bun test` 출력 모사(실측 기반).
const MATCH = ' 15 pass\n 0 fail\nRan 15 tests across 1 file. [10.00ms]\n';
const MATCH_2FILES = ' 30 pass\n 0 fail\nRan 30 tests across 2 files. [20.00ms]\n';
// 미매칭(오타·no-match): 실측상 요약 라인이 없고 exit 0.
const NOMATCH = 'Test filter "./test/zzz-typo.test.ts" had no matches in --cwd="/x"\n';
const ZERO_FILES = '0 pass\n0 fail\nRan 0 tests across 0 files. [1.00ms]\n';
const FAILING = ' 3 pass\n 2 fail\nRan 5 tests across 1 file. [12.00ms]\n';

/** 필터→모사 출력 매핑 spawn. */
function fakeSpawn(map: Record<string, string>): TestSpawn {
  return (filter: string) => map[filter] ?? NOMATCH;
}

describe('filterMatched', () => {
  it('요약+파일>0 이면 매칭', () => {
    expect(filterMatched(parseTestOutput(MATCH))).toBe(true);
  });
  it('요약 없으면(오타 no-match) 미매칭', () => {
    expect(filterMatched(parseTestOutput(NOMATCH))).toBe(false);
  });
  it('Ran 0 across 0 도 미매칭', () => {
    expect(filterMatched(parseTestOutput('0 pass\n0 fail\nRan 0 tests across 0 files.'))).toBe(false);
  });
});

describe('run_tests 다중필터 판정 (§8 핵심)', () => {
  it('존재필터 + 오타필터 → unmatchedFilters 에 오타가 잡히고 ok=false (거짓통과 차단)', () => {
    const res = runTestsMultiFilter(
      ['./src/agent-mission/parse.test.ts', './test/zzz-typo.test.ts'],
      '/x', 1000,
      fakeSpawn({ './src/agent-mission/parse.test.ts': MATCH }),
    );
    expect(res.unmatchedFilters).toEqual(['./test/zzz-typo.test.ts']);
    expect(res.ok).toBe(false);
    // 종전 거짓통과: 매칭 필터의 15 pass 를 흡수해 pass>0·exit0 로 통과했음.
    expect(res.pass).toBe(15);
    expect(res.fail).toBe(0);
    expect(res.filesRan).toBe(1);
  });

  it('전 필터 매칭 → ok=true · unmatchedFilters 비어있음', () => {
    const res = runTestsMultiFilter(
      ['a', 'b'], '/x', 1000,
      fakeSpawn({ a: MATCH, b: MATCH_2FILES }),
    );
    expect(res.unmatchedFilters).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.filesRan).toBe(3);
    expect(res.pass).toBe(45);
  });

  it('한 필터라도 실패 있으면 ok=false', () => {
    const res = runTestsMultiFilter(
      ['a', 'b'], '/x', 1000,
      fakeSpawn({ a: MATCH, b: FAILING }),
    );
    expect(res.unmatchedFilters).toEqual([]);
    expect(res.fail).toBe(2);
    expect(res.ok).toBe(false);
  });

  it('모든 필터 미매칭 → ok=false · pass 0', () => {
    const res = runTestsMultiFilter(['x', 'y'], '/x', 1000, fakeSpawn({}));
    expect(res.unmatchedFilters).toEqual(['x', 'y']);
    expect(res.pass).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('aggregateFilterRuns 순수 집계', () => {
    const res = aggregateFilterRuns([
      { filter: 'a', outcome: parseTestOutput(MATCH) },
      { filter: 'typo', outcome: parseTestOutput(NOMATCH) },
    ]);
    expect(res.requestedFilters).toEqual(['a', 'typo']);
    expect(res.unmatchedFilters).toEqual(['typo']);
    expect(res.ok).toBe(false);
  });
});

describe('integrity-gate OH8 이식', () => {
  /** runCmd 를 모사 — 마지막 arg(필터)로 출력 결정. */
  function fakeRunCmd(map: Record<string, string>): RunCmd {
    return async (_cmd, args) => {
      // args = ['test', <filter...>] — 필터들을 한 번에 받는 구조.
      const filters = args.slice(1);
      const out = filters.map(f => map[f] ?? '').join('');
      // 하나라도 매칭이면 요약이 있고, 전부 no-match 면 요약 없음(실측 동형).
      const hasMatch = filters.some(f => map[f]);
      const code = /(\d+)\s+fail/.test(out) && !/\s0\s+fail/.test(out) ? 1 : 0;
      return { code: hasMatch ? code : 0, stdout: out, stderr: '', timedOut: false };
    };
  }

  it('실행 요약 부재와 0 매칭 파일을 다르게 기록하며 둘 다 기존대로 not-ok다', async () => {
    const missingSummary = await runIntegrityGate('/x', {
      steps: ['test'],
      testArgs: ['src/typo-nowhere/'],
      runCmd: fakeRunCmd({}),
    });
    const zeroFiles = await runIntegrityGate('/x', {
      steps: ['test'],
      testArgs: ['src/zero-files/'],
      runCmd: fakeRunCmd({ 'src/zero-files/': ZERO_FILES }),
    });

    expect(missingSummary.passed).toBe(false);
    expect(zeroFiles.passed).toBe(false);
    expect(missingSummary.steps[0]!.summary).toContain('test run summary was absent');
    expect(missingSummary.steps[0]!.summary).toContain('matched file count is unknown');
    expect(missingSummary.steps[0]!.summary).not.toContain('no-match/오타?');
    expect(zeroFiles.steps[0]!.summary).toContain('0 files ran (필터 전체 no-match/오타?)');
    expect(zeroFiles.steps[0]!.summary).toContain('matched-files=0');
    expect(missingSummary.steps[0]!.summary).toContain('elapsed=');
    expect(missingSummary.steps[0]!.summary).toContain('code=0');
    expect(missingSummary.steps[0]!.summary).not.toBe(zeroFiles.steps[0]!.summary);
  });

  it('정상 필터(매칭) → 무회귀 pass', async () => {
    const gate = await runIntegrityGate('/x', {
      steps: ['test'],
      testArgs: ['src/autopilot/'],
      runCmd: fakeRunCmd({ 'src/autopilot/': MATCH }),
    });
    expect(gate.passed).toBe(true);
  });

  it('일부 test-less 스코프여도 최소 1개 매칭이면 pass (무회귀 — deriveGateScopes 정당 케이스)', async () => {
    // deriveGateScopes 는 baseScope + 변경 디렉토리를 낸다. 변경 디렉토리가 test-less 여도
    // baseScope 가 매칭하면 게이트는 통과해야 한다(필터별 강제는 무회귀 위반).
    const gate = await runIntegrityGate('/x', {
      steps: ['test'],
      testArgs: ['src/autopilot/', 'src/skills/tools/'],
      runCmd: fakeRunCmd({ 'src/autopilot/': MATCH }), // src/skills/tools/ 는 no-match
    });
    expect(gate.passed).toBe(true);
  });

  it('필터 실패(fail>0) → not-ok (종전 동작 유지)', async () => {
    const gate = await runIntegrityGate('/x', {
      steps: ['test'],
      testArgs: ['src/autopilot/'],
      runCmd: fakeRunCmd({ 'src/autopilot/': FAILING }),
    });
    expect(gate.passed).toBe(false);
  });
});
