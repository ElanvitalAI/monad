// ⛔⭐ 배선 시험 — 주입 seam 은 «달려 있어야» 값을 낸다(이 저장소의 그 규율).
//   📏 왜 이 파일이 생겼나(2026-08-11 73차): `askTargetPaths` 를 preflight 에 «더했는데»
//     실제 deps 빌더에 안 달면 문면이 영영 안 바뀐다 — ***형태만 착지하고 실행 경로엔 없는*** 그 함정.
import { describe, expect, test } from 'bun:test';
import { buildAskPreflightDeps } from './ask-launch-io.js';
import { decideAskPreflight, evaluateLaunchPreflight, renderLaunchPreflight } from './launch-preflight.js';
import { ORIGINAL_ASK_MARKER } from '../self-implement/goal-author.js';
import type { RunningRunsResult } from '../self-implement/running-runs.js';

describe('buildAskPreflightDeps — 주입 seam 이 «달려 있다»', () => {
  const measuredNoRunningRuns: RunningRunsResult = {
    entries: [],
    counts: { running: 0, 'probable-running': 0, 'ended-unclosed': 0, unknown: 0 },
    total: 0,
    countedStatuses: ['running', 'probable-running'],
    quantities: {
      counts: { value: { running: 0, 'probable-running': 0, 'ended-unclosed': 0, unknown: 0 }, population: 'all assessed runs', observation: { runsNotYetInLedgerDuringAuthoringAreNotCounted: true, includesTest: true } },
      total: { value: 0, population: 'all assessed runs', observation: { runsNotYetInLedgerDuringAuthoringAreNotCounted: true, includesTest: true } },
      entries: { value: 0, population: 'all assessed runs', observation: { runsNotYetInLedgerDuringAuthoringAreNotCounted: true, includesTest: true } },
      running: { value: 0, population: 'assessed runs whose status is in countedStatuses', observation: { runsNotYetInLedgerDuringAuthoringAreNotCounted: true, includesTest: true } },
    },
    observation: { runsNotYetInLedgerDuringAuthoringAreNotCounted: true, includesTest: true },
    ledger: { ledgerDirectories: [], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0, missingLedgerDirectoryCount: 0, unreadableLedgerDirectoryAccessCount: 0, indeterminateLedgerDirectoryCount: 0 },
    pty: { unreadable: [], observedRefCount: 0, withoutRunIdCount: 0, notCountedRefCount: 0 },
  };

  const goalDocument = [
    '## PROBLEM',
    'Situation: GROUNDED — verified production authoring path.',
    '',
    ORIGINAL_ASK_MARKER,
    '```',
    '대상 경로: src/a.ts · src/b.ts',
    '이 함수를 고친다.',
    '```',
    '',
    '## TRACED PATHS',
    '1. src/a.ts — target',
    '2. src/evidence.ts — verified production consumer (근거일 뿐이다)',
  ].join('\n');

  test('askTargetPaths 가 달려 있고 «ask 가 댄 경로만» 준다', async () => {
    const deps = await buildAskPreflightDeps();
    expect(typeof deps.askTargetPaths).toBe('function');
    expect(deps.askTargetPaths!(goalDocument)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('tracedPaths 는 «근거까지» 준다 — 두 값이 다르다는 것이 이 seam 의 이유다', async () => {
    const deps = await buildAskPreflightDeps();
    const traced = deps.tracedPaths(goalDocument);
    expect(traced).toContain('src/evidence.ts');
    expect(deps.askTargetPaths!(goalDocument)).not.toContain('src/evidence.ts');
  });

  test('ask 표지가 없으면 «빈 배열» — 던지지 않고 지어내지도 않는다', async () => {
    const deps = await buildAskPreflightDeps();
    expect(deps.askTargetPaths!('## PROBLEM\n본문뿐')).toEqual([]);
  });

  test('경로를 아는 완료·중단·미완 조회는 대상 경로를 전달하고 상한·미독 결과를 보존한다', async () => {
    const completedPaths: Array<string | readonly string[] | undefined> = [];
    const interruptedPaths: Array<string | readonly string[] | undefined> = [];
    const unfinishedPaths: Array<string | undefined> = [];
    const deps = await buildAskPreflightDeps({
      completedRunLookup: (_limit, path) => {
        completedPaths.push(path);
        return { entries: [{ runId: 'run-completed', ledgerDirectory: '/state/ledger' }], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0, limit: 1, truncated: true };
      },
      interruptedRunLookup: (_limit, path) => {
        interruptedPaths.push(path);
        return { entries: [], unreadableLedgerCount: 1, unreadableLedgerDirectoryCount: 0, limit: 1 };
      },
      unfinishedRunLookup: (path) => {
        unfinishedPaths.push(path);
        return [];
      },
      loadRunLedger: () => [{ event: 'start', data: { goalFile: '/goals/completed.md' } }],
      readGoalDocument: () => 'goal',
      tracedPaths: () => ['src/a.ts'],
    });

    expect(deps.listCompletedRuns!(1, 'src/a.ts')).toEqual({ entries: [{ runId: 'run-completed', plannedPaths: ['src/a.ts'], ledgerDirectory: '/state/ledger' }], unreadableRuns: 0, limit: 1, truncated: true });
    expect(deps.listInterruptedRuns!(1, 'src/a.ts')).toEqual({
      entries: [],
      unreadableRuns: 1,
      limit: 1,
    });
    expect(deps.listUnfinishedRuns!('src/a.ts')).toEqual([]);
    expect(completedPaths).toEqual(['src/a.ts']);
    expect(interruptedPaths).toEqual(['src/a.ts']);
    expect(unfinishedPaths).toEqual(['src/a.ts']);
  });

  test('여러 경로 완료·중단 조회는 같은 배열을 그대로 전달한다', async () => {
    const completedPaths: Array<string | readonly string[] | undefined> = [];
    const interruptedPaths: Array<string | readonly string[] | undefined> = [];
    const paths = ['src/a.ts', 'src/a.test.ts'];
    const deps = await buildAskPreflightDeps({
      completedRunLookup: (_limit, value) => {
        completedPaths.push(value);
        return { entries: [], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0 };
      },
      interruptedRunLookup: (_limit, value) => {
        interruptedPaths.push(value);
        return { entries: [], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0 };
      },
    });

    deps.listCompletedRuns!(1, paths);
    deps.listInterruptedRuns!(1, paths);
    expect(completedPaths).toEqual([paths]);
    expect(interruptedPaths).toEqual([paths]);
  });

  test('decideAskPreflight 는 두 대상 경로를 조회와 같은-경로 결과까지 보존한다', async () => {
    const paths = ['src/a.ts', 'src/a.test.ts'];
    const completedCalls: Array<string | readonly string[] | undefined> = [];
    const interruptedCalls: Array<string | readonly string[] | undefined> = [];
    const deps = await buildAskPreflightDeps({
      completedRunLookup: (_limit, value) => {
        completedCalls.push(value);
        return {
          entries: [
            { runId: 'run-completed-source', ledgerDirectory: '/state/ledger' },
            { runId: 'run-completed-test', ledgerDirectory: '/state/ledger' },
          ],
          unreadableLedgerCount: 0,
          unreadableLedgerDirectoryCount: 0,
          limit: 2,
          truncated: true,
        };
      },
      interruptedRunLookup: (_limit, value) => {
        interruptedCalls.push(value);
        return {
          entries: [
            { runId: 'run-interrupted-source', interruptionReason: 'source failure', ledgerDirectory: '/state/ledger' },
            { runId: 'run-interrupted-test', interruptionReason: 'test failure', ledgerDirectory: '/state/ledger' },
          ],
          unreadableLedgerCount: 0,
          unreadableLedgerDirectoryCount: 0,
          limit: 2,
        };
      },
      loadRunLedger: (runId) => [{ event: 'start', data: { goalFile: `/goals/${runId}.md` } }],
      readGoalDocument: (goalFile) => goalFile.endsWith('source.md') ? 'source' : 'test',
      tracedPaths: (document) => document === 'source' ? [paths[0]!] : [paths[1]!],
    });

    const decision = decideAskPreflight({
      goalFile: 'goal.md',
      pathsOverride: paths,
      liveRunWindowMinutes: 30,
      recentChangeWindowDays: 7,
      interruptedRunsLimit: 2,
    }, {
      ...deps,
      listOpenPrs: () => [],
      listUnfinishedRuns: () => [],
      queryRunningRuns: () => measuredNoRunningRuns,
      listPreexistingFailureTestFiles: () => ({ state: 'checked', files: [] }),
    }, false);

    expect(completedCalls).toEqual([paths]);
    expect(interruptedCalls).toEqual([paths]);
    expect(decision.result.completedRuns).toEqual({ state: 'truncated', count: 2, limit: 2 });
    expect(decision.result.completedRunMatches).toEqual([
      { runId: 'run-completed-source', plannedPaths: [paths[0]], ledgerDirectory: '/state/ledger' },
      { runId: 'run-completed-test', plannedPaths: [paths[1]], ledgerDirectory: '/state/ledger' },
    ]);
    expect(decision.result.interruptedRuns).toEqual({ state: 'truncated', count: 2, limit: 2 });
    expect(decision.result.interruptedRunMatches).toEqual([
      { runId: 'run-interrupted-source', plannedPaths: [paths[0]], interruptionReason: 'source failure', ledgerDirectory: '/state/ledger' },
      { runId: 'run-interrupted-test', plannedPaths: [paths[1]], interruptionReason: 'test failure', ledgerDirectory: '/state/ledger' },
    ]);
  });

  test('경로를 모르는 완료·중단 조회는 path 없이 호출한다', async () => {
    const completedPaths: Array<string | readonly string[] | undefined> = [];
    const interruptedPaths: Array<string | readonly string[] | undefined> = [];
    const deps = await buildAskPreflightDeps({
      completedRunLookup: (_limit, path) => {
        completedPaths.push(path);
        return { entries: [], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0 };
      },
      interruptedRunLookup: (_limit, path) => {
        interruptedPaths.push(path);
        return { entries: [], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0 };
      },
    });

    deps.listCompletedRuns!(1);
    deps.listInterruptedRuns!(1);
    expect(completedPaths).toEqual([undefined]);
    expect(interruptedPaths).toEqual([undefined]);
  });

  test('중단 런 경로 관측은 원장 예외·null·goalFile 누락·골 문서 실패를 별도 계수로 보존한다', async () => {
    const deps = await buildAskPreflightDeps({
      interruptedRunLookup: () => ({
        entries: [
          { runId: 'ledger-throws', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'ledger-null', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'goal-file-missing', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'goal-document-unreadable', interruptionReason: null, ledgerDirectory: '/state/ledger' },
        ],
        unreadableLedgerCount: 0,
        unreadableLedgerDirectoryCount: 0,
      }),
      loadRunLedger: (runId) => {
        if (runId === 'ledger-throws') throw new Error('malformed ledger');
        if (runId === 'ledger-null') return null;
        if (runId === 'goal-file-missing') return [{ event: 'start', data: {} }];
        return [{ event: 'start', data: { goalFile: '/goals/unreadable.md' } }];
      },
      readGoalDocument: () => { throw new Error('ENOENT'); },
    });

    const interruptedRuns = deps.listInterruptedRuns!(200);
    expect(interruptedRuns).toEqual({
      entries: [],
      unreadableRuns: 4,
      observationFailures: {
        ledgerLoadThrows: 1,
        nullLedgers: 1,
        missingGoalFileNames: 1,
        unreadableOrMissingGoalDocuments: 1,
      },
    });
    const failures = interruptedRuns.observationFailures!;
    expect(interruptedRuns.unreadableRuns).toBe(
      failures.ledgerLoadThrows!
      + failures.nullLedgers!
      + failures.missingGoalFileNames!
      + failures.unreadableOrMissingGoalDocuments!,
    );
  });

  // ⭐ 「넷이 다 1」은 «오분류를 못 가른다» — 1↔1 이 바뀌어도 합계가 같다(리뷰 지적 2026-09-17).
  //   ⇒ 원인마다 «다른 수»를 줘서 각 칸이 «자기 원인»만 세는지 본다.
  test('네 원인이 서로 다른 수일 때 각 칸이 «자기 원인»만 센다 — 오분류가 있으면 이 시험이 빨강이다', async () => {
    const deps = await buildAskPreflightDeps({
      interruptedRunLookup: () => ({
        entries: [
          // ledgerLoadThrows 1 · nullLedgers 2 · missingGoalFileNames 3 · unreadableOrMissingGoalDocuments 4
          { runId: 'throws-1', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'null-1', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'null-2', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'nofile-1', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'nofile-2', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'nofile-3', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'doc-1', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'doc-2', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'doc-3', interruptionReason: null, ledgerDirectory: '/state/ledger' },
          { runId: 'doc-4', interruptionReason: null, ledgerDirectory: '/state/ledger' },
        ],
        unreadableLedgerCount: 0,
        unreadableLedgerDirectoryCount: 0,
      }),
      loadRunLedger: (runId) => {
        if (runId.startsWith('throws-')) throw new Error('malformed ledger');
        if (runId.startsWith('null-')) return null;
        if (runId.startsWith('nofile-')) return [{ event: 'start', data: {} }];
        return [{ event: 'start', data: { goalFile: '/goals/unreadable.md' } }];
      },
      readGoalDocument: () => { throw new Error('ENOENT'); },
    });

    const interruptedRuns = deps.listInterruptedRuns!(200);
    const failures = interruptedRuns.observationFailures!;
    // ⛔ 합계만 보지 «않는다» — 칸마다 «다른 수»를 단언한다
    expect(failures.ledgerLoadThrows).toBe(1);
    expect(failures.nullLedgers).toBe(2);
    expect(failures.missingGoalFileNames).toBe(3);
    expect(failures.unreadableOrMissingGoalDocuments).toBe(4);
    expect(interruptedRuns.unreadableRuns).toBe(10);
  });

  test.each([
    ['원장 로드 예외', 'ledger-throws', { ledgerLoadThrows: 1, nullLedgers: 0, missingGoalFileNames: 0, unreadableOrMissingGoalDocuments: 0 }],
    ['null 원장', 'ledger-null', { ledgerLoadThrows: 0, nullLedgers: 1, missingGoalFileNames: 0, unreadableOrMissingGoalDocuments: 0 }],
    ['goalFile 이름 없음', 'goal-file-missing', { ledgerLoadThrows: 0, nullLedgers: 0, missingGoalFileNames: 1, unreadableOrMissingGoalDocuments: 0 }],
    ['골 문서 판독 불가', 'goal-document-unreadable', { ledgerLoadThrows: 0, nullLedgers: 0, missingGoalFileNames: 0, unreadableOrMissingGoalDocuments: 1 }],
  ] as const)('%s 단독 입력은 자신의 계수만 올리고 unreadableRuns 합계를 보존한다', async (_label, runId, observationFailures) => {
    const deps = await buildAskPreflightDeps({
      interruptedRunLookup: () => ({
        entries: [{ runId, interruptionReason: null, ledgerDirectory: '/state/ledger' }],
        unreadableLedgerCount: 0,
        unreadableLedgerDirectoryCount: 0,
      }),
      loadRunLedger: (candidateRunId) => {
        if (candidateRunId === 'ledger-throws') throw new Error('malformed ledger');
        if (candidateRunId === 'ledger-null') return null;
        if (candidateRunId === 'goal-file-missing') return [{ event: 'start', data: {} }];
        return [{ event: 'start', data: { goalFile: '/goals/unreadable.md' } }];
      },
      readGoalDocument: () => { throw new Error('ENOENT'); },
    });

    expect(deps.listInterruptedRuns!(200)).toEqual({ entries: [], unreadableRuns: 1, observationFailures });
  });

  test('초기 원장·디렉터리 실패와 변환 실패가 함께 있어도 전체·알려진 원인·미분류 잔여를 어댑터→평가→렌더로 보존한다', async () => {
    const deps = await buildAskPreflightDeps({
      interruptedRunLookup: () => ({
        entries: [{ runId: 'ledger-throws', interruptionReason: null, ledgerDirectory: '/state/ledger' }],
        unreadableLedgerCount: 1,
        unreadableLedgerDirectoryCount: 1,
      }),
      loadRunLedger: () => { throw new Error('malformed ledger'); },
    });
    const interruptedRuns = deps.listInterruptedRuns!(200);
    const result = evaluateLaunchPreflight({
      paths: ['src/a.ts'],
      openPrs: [],
      unfinishedRuns: [],
      interruptedRuns,
      liveRunWindowMs: 30 * 60_000,
    });

    expect(interruptedRuns).toEqual({
      entries: [],
      unreadableRuns: 3,
      observationFailures: { ledgerLoadThrows: 1, nullLedgers: 0, missingGoalFileNames: 0, unreadableOrMissingGoalDocuments: 0 },
    });
    expect(result.interruptedRuns).toEqual({
      state: 'unreadableRuns',
      count: 0,
      unreadableRuns: 3,
      observationFailures: { ledgerLoadThrows: 1, nullLedgers: 0, missingGoalFileNames: 0, unreadableOrMissingGoalDocuments: 0 },
    });
    expect(renderLaunchPreflight(result)).toContain('중단 런: ⚠️ 0건 조회 · 3건 원장 판독 불가 (원장 로드 예외 1건) · 기타/미분류 실패 2건 · 같은 경로 0건');
  });

  test('완료 런의 원시 상한은 경로 추출 실패 뒤에도 전달한다', async () => {
    const deps = await buildAskPreflightDeps({
      completedRunLookup: () => ({ entries: [{ runId: 'run-unreadable', ledgerDirectory: '/state/ledger' }], unreadableLedgerCount: 0, unreadableLedgerDirectoryCount: 0, limit: 1, truncated: true }),
      loadRunLedger: () => null,
    });
    expect(deps.listCompletedRuns!(1)).toEqual({ entries: [], unreadableRuns: 1, limit: 1, truncated: true });
  });

  test.each([
    ['분할 수가 모두 있으면 missing은 빼고 접근·판별 불가와 파일 실패만 센다', {
      unreadableLedgerCount: 2,
      unreadableLedgerDirectoryCount: 7,
      missingLedgerDirectoryCount: 4,
      unreadableLedgerDirectoryAccessCount: 1,
      indeterminateLedgerDirectoryCount: 2,
    }, 5],
    ['호환 총합만 있으면 기존 총합을 보존한다', {
      unreadableLedgerCount: 2,
      unreadableLedgerDirectoryCount: 3,
    }, 5],
    ['missing과 호환 총합만 있으면 missing을 빼고 남은 실패만 센다', {
      unreadableLedgerCount: 2,
      unreadableLedgerDirectoryCount: 7,
      missingLedgerDirectoryCount: 4,
    }, 5],
    ['판별 불가만 있으면 호환 총합을 다시 더하지 않는다', {
      unreadableLedgerCount: 2,
      unreadableLedgerDirectoryCount: 7,
      indeterminateLedgerDirectoryCount: 2,
    }, 4],
  ])('%s', async (_name, lookup, unreadableRuns) => {
    const deps = await buildAskPreflightDeps({
      interruptedRunLookup: () => ({ entries: [], ...lookup }),
    });

    expect(deps.listInterruptedRuns!(200)).toEqual({
      entries: [],
      unreadableRuns,
    });
  });
});

describe('buildAskPreflightDeps — listOpenPrs gh 조회 필드', () => {
  test('listOpenPrs 가 gh pr list 를 호출하고 --limit 과 number,title,files,isDraft,headRefName 을 파싱한다', async () => {
    const calls: Array<{ file: string; args: readonly string[]; options: { encoding: 'utf8' } }> = [];
    const payload = [{
      number: 8100,
      title: 'open overlapping pr',
      files: [{ path: 'src/self-dev/ask-launch-io.ts' }],
      isDraft: true,
      headRefName: 'feat/ask-launch-io',
    }];
    const deps = await buildAskPreflightDeps({
      execFileSync: (file, args, options) => {
        calls.push({ file, args, options });
        return JSON.stringify(payload);
      },
    });

    expect(deps.listOpenPrs(17)).toEqual(payload);
    expect(calls).toEqual([{
      file: 'gh',
      args: ['pr', 'list', '--state', 'open', '--limit', '17', '--json', 'number,title,files,isDraft,headRefName'],
      options: { encoding: 'utf8' },
    }]);
  });
});
