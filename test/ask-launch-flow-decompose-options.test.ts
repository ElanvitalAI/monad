import { describe, expect, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { runAskLaunchFlow, type AskLaunchFlowDeps } from '../src/self-dev/ask-launch-flow.js';
import { CLI_DEV_ASK_ENTRANCE } from '../src/self-dev/entrance-registry.js';

const GOAL = '/repo/docs/goals/GOAL-x.md';
const DOCUMENT = [
  '- GoalId: 0123456789abcdef',
  '',
  '## PROBLEM',
  '대상 경로: src/a.ts',
].join('\n');

function harness(overrides: Partial<AskLaunchFlowDeps> = {}) {
  const deps: AskLaunchFlowDeps = {
    print: () => {},
    log: () => {},
    readLine: async () => '',
    readFile: () => DOCUMENT,
    writeFile: () => {},
    cwd: () => '/repo',
    now: () => 1_786_440_000_000,
    isInteractive: () => false,
    buildPreflightDeps: async () => ({
      readGoalDocument: () => DOCUMENT,
      tracedPaths: () => ['src/a.ts'],
      listOpenPrs: () => [],
      listUnfinishedRuns: () => [],
      countRecentChanges: () => ({}),
    }),
    priorBlockSamples: () => [],
    recentAuthoringSamples: () => [],
    authorGoal: async () => ({ path: GOAL, authored: { document: DOCUMENT, grounded: true } }),
    relativeToCwd: (file) => file.replace('/repo/', ''),
    ...overrides,
  };
  return deps;
}

const input = {
  entrance: CLI_DEV_ASK_ENTRANCE,
  inputSource: 'say' as const,
  askText: '대상 경로: src/a.ts',
  liveRunWindowMinutes: 30,
  recentChangeWindowDays: 7,
  forceRequested: false,
};

describe('runAskLaunchFlow decomposeOptions', () => {
  test('passes explicit Fabric selection to the existing Fabric decomposition branch', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    let fabricCalls = 0;
    (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
      events.push({ event, data: data as Record<string, unknown> });
    }) as typeof debug.log;
    try {
      const result = await runAskLaunchFlow(input, harness({
        decomposeOptions: {
          decomposer: 'fabric',
          fabric: {
            context: { goal: 'unused', groundingContext: 'grounded context' },
            resolve: async () => 'unused',
            decompose: async (feature, context) => {
              fabricCalls++;
              expect(feature).toBe(DOCUMENT);
              expect(context.groundingContext).toBe('grounded context');
              return {
                status: 'decomposed',
                goals: [{ id: 'fabric', feature: 'fabric goal' }],
                decompositions: [],
                rfc: {} as never,
                omittedGoalCount: 0,
                budgetSkippedArcCount: 0,
                budgetLimited: false,
              };
            },
          },
        },
      }));

      expect(result).toEqual({ kind: 'launch', goalFile: GOAL });
      expect(fabricCalls).toBe(1);
      expect(events.filter(({ event }) => event === 'runtime.decomposer-selection')).toEqual([
        // ⛔ 관측 «전 칸»을 문다 — 새 칸이 조용히 늘면 여기가 빨개진다(그것이 이 시험의 값이다).
        //   `autoPathThreshold`·`normalizedPathCount` 는 #15380(크기 AUTO 라우팅 관측)이 더한 칸이다.
        { event: 'runtime.decomposer-selection', data: { surface: 'cli', decomposer: 'fabric', source: 'request', autoPathThreshold: 5, normalizedPathCount: undefined } },
      ]);
      expect(events.filter(({ event }) => event === 'prelaunch-decomposition.decomposer-selection')).toEqual([
        // `goalIdStatus` 는 #15272(분해 관측이 조인키를 잃는다)가 더한 칸이다.
        { event: 'prelaunch-decomposition.decomposer-selection', data: { decomposer: 'fabric', goalId: null, goalIdStatus: 'unknown', runId: null } },
      ]);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
  }, 30_000);

  test('keeps the default decomposer when no selection is supplied', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const original = debug.log;
    let defaultCalls = 0;
    (debug as { log: typeof debug.log }).log = ((_category, event, data) => {
      events.push({ event, data: data as Record<string, unknown> });
    }) as typeof debug.log;
    try {
      await runAskLaunchFlow(input, harness({
        decomposeOptions: {
          llm: async () => {
            defaultCalls++;
            return JSON.stringify({ subtasks: [{ id: 'default', feature: 'default goal' }] });
          },
        },
      }));

      expect(defaultCalls).toBe(1);
      expect(events.filter(({ event }) => event === 'prelaunch-decomposition.decomposer-selection')).toEqual([
        { event: 'prelaunch-decomposition.decomposer-selection', data: { decomposer: 'default', goalId: null, goalIdStatus: 'unknown', runId: null } },
      ]);
    } finally {
      (debug as { log: typeof debug.log }).log = original;
    }
  }, 30_000);
});
