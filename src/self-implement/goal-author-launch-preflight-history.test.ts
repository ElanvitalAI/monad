import { expect, test } from 'bun:test';
import type { CodebaseGrounding } from '../autopilot/mission-codebase-gate.js';
import { authorGoal, type GoalAuthorDeps } from './goal-author.js';
import type { LaunchPreflightResult } from '../self-dev/launch-preflight.js';

const facts: CodebaseGrounding = {
  grounded: false, context: '', files: [], codeFacts: [], skillFacts: [], memoryFacts: [],
  documentFacts: [], refFacts: [], ptyFacts: [],
};

const deps: GoalAuthorDeps = {
  ground: async () => facts,
  enhance: async (original) => ({ original, checklist: [], verbatimPreserved: true }),
  goalId: '1234567890abcdef',
};

function preflight(completedState: LaunchPreflightResult['completedRuns'] = { state: 'checked', count: 0 }): LaunchPreflightResult {
  return {
    // ⛔ 2026-08-23: `missingDeclaredPathCount` 가 «필수»로 추가됐다(#pathexists).
    //   bun test 는 타입-블라인드라 이 목이 안 따라가도 «초록»으로 보인다 — tsc 전수에서만 잡힌다.
    paths: ['src/self-implement/goal-author.ts'], blockers: [], warnings: [],
    missingDeclaredPathCount: 0,
    openPrs: { state: 'checked', count: 1 }, liveRuns: { state: 'checked', count: 0 },
    completedRuns: completedState, completedRunMatches: [],
    interruptedRuns: { state: 'checked', count: 1 },
    interruptedRunMatches: [{
      runId: 'run-interrupted', plannedPaths: ['src/self-implement/goal-author.ts'],
      interruptionReason: 'typecheck failed', ledgerDirectory: '/tmp/ledger',
    }],
    activeUnfinishedRuns: { state: 'checked', count: 0 }, inactiveUnfinishedRuns: { state: 'checked', count: 0 },
    unreadableUnfinishedRunAges: { state: 'checked', count: 0 }, recentChanges: { state: 'checked', count: 2 },
    preexistingFailures: { state: 'checked', files: ['src/self-implement/goal-author-launch-preflight-history.test.ts'] }, recentChangeWindowDays: 7,
    unreadableRuns: 0, liveRunWindowMs: 60_000,
  };
}

test('renders caller-supplied same-path preflight history while preserving omitted output byte-for-byte', async () => {
  const ask = '대상 경로: src/self-implement/goal-author.ts\n선택적 이력을 저작 문서에 더한다.';
  const omitted = await authorGoal(ask, deps);
  const omittedExplicitly = await authorGoal(ask, { ...deps, launchPreflight: undefined });
  const supplied = await authorGoal(ask, { ...deps, launchPreflight: preflight() });

  expect(omittedExplicitly.document).toBe(omitted.document);
  expect(omitted.document).not.toContain('### 같은 대상 경로의 지난 이력');
  expect(supplied.document).toContain('### 같은 대상 경로의 지난 이력');
  expect(supplied.document).toContain('열린 PR: 1건 조회');
  expect(supplied.document).toContain('완료 런: 0건 조회 · 같은 경로 0건');
  expect(supplied.document).toContain('중단 런: 1건 조회 · 같은 경로 1건: run-interrupted (typecheck failed · /tmp/ledger)');
  expect(supplied.document).toContain('최근 변경: 2건 조회 · 최근 변경 임계 7일');
  expect(supplied.document).toContain('gate preexisting 실패 기록: 같은 대상 1개: src/self-implement/goal-author-launch-preflight-history.test.ts');
});

test('distinguishes no same-path history from a failed completed-history lookup', async () => {
  const ask = '대상 경로: src/self-implement/goal-author.ts\n이력 상태를 구별한다.';
  const none = await authorGoal(ask, { ...deps, launchPreflight: preflight() });
  const unavailable = await authorGoal(ask, {
    ...deps,
    launchPreflight: preflight({ state: 'unknown', reason: '완료 런 조회 실패' }),
  });

  expect(none.document).toContain('완료 런: 0건 조회 · 같은 경로 0건');
  expect(unavailable.document).toContain('완료 런: ⚠️ 미지 — 완료 런 조회 실패 (⛔ 「없음」이 아니다)');
  expect(unavailable.document).not.toContain('완료 런: 0건 조회 · 같은 경로 0건');
});
