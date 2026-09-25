import { afterEach, describe, expect, test } from 'bun:test';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.js';
import { TaskEventBus } from '../src/task-orchestrator/events.js';
import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.js';
import { TaskGraph } from '../src/task-orchestrator/graph.js';
import { createTask } from '../src/task-orchestrator/types.js';
import {
  clearPendingDecomposeForTest,
  resetToxRuntimeDepsForTest,
  setToxRuntimeDeps,
} from '../src/task-orchestrator/runtime-deps.js';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.js';
import type { TaskSurface } from '../src/task-orchestrator/types.js';
import { createIntakeStore, resolveIntakeSlash } from '../src/intake-plane/index.js';
import type { EnrichedDecomposition } from '../src/intake-plane/enrich.js';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function makeGenerator(proposal: unknown): TaskGenerator {
  return new TaskGenerator({
    callable: (async () => ({ text: JSON.stringify(proposal) })) as DecomposeCallable,
  });
}

afterEach(() => {
  clearPendingDecomposeForTest();
  resetToxRuntimeDepsForTest();
});

describe('resolveIntakeSlash', () => {
  test('capture creates an intake draft from inline text', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await resolveIntakeSlash(['capture', '- compare two repos'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
    });
    expect(result.output).toContain('Intake draft: intake-fixed');
    expect(result.output).toContain('[comparison]');
    expect(store.getSession('intake-fixed')?.state).toBe('review-ready');
    expect(result.session?.intakeId).toBe('intake-fixed');
  });

  test('draft captures the current scratch note into an intake session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: [
          '- check screen recording source',
          '- image preview bug why not working',
        ],
      }),
    });
    expect(result.output).toContain('Intake draft: intake-fixed');
    expect(result.output).toContain('[research]');
    expect(result.output).toContain('[bug]');
    expect(store.getSession('intake-fixed')?.state).toBe('review-ready');
    expect(result.session?.intakeId).toBe('intake-fixed');
  });

  test('review shows the latest draft', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    const result = await resolveIntakeSlash(['review'], { store });
    expect(result.output).toContain('Intake draft: intake-fixed');
    expect(result.output).toContain('[comparison]');
    expect(result.session?.intakeId).toBe('intake-fixed');
  });

  test('stale search test: list renders draft titles and show renders raw text', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'compare', 'two', 'repos'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-compare',
    });
    await resolveIntakeSlash(['capture', 'raw-body-only-marker'], {
      store,
      now: () => new Date('2026-04-30T12:01:00.000Z'),
      createIntakeId: () => 'intake-bug',
    });
    const bug = store.getSession('intake-bug');
    if (!bug?.draft) throw new Error('expected captured intake draft');
    store.saveDraft('intake-bug', { ...bug.draft, title: 'draft-title-only-marker' });

    const listed = await resolveIntakeSlash(['list'], { store });
    expect(listed.output).toContain('intake-bug');
    expect(listed.output).toContain('draft-title-only-marker');
    expect(listed.output).not.toContain('raw-body-only-marker');

    const shown = await resolveIntakeSlash(['show', 'intake-bug'], { store });
    expect(shown.output).toContain('raw: raw-body-only-marker');
  });

  test('show renders a session summary including raw/source metadata', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'compare', 'two', 'repos'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
    });
    const result = await resolveIntakeSlash(['show'], { store });
    expect(result.output).toContain('Intake session: intake-fixed');
    expect(result.output).toContain('source: tui-scratch');
    expect(result.output).toContain('inputSource: keyboard');
    expect(result.output).toContain('attachments: 0');
    expect(result.output).toContain('raw: compare two repos');
    expect(result.session?.intakeId).toBe('intake-fixed');
  });

  test('replay clones an older intake into a fresh session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'compare', 'two', 'repos'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-old',
    });
    const result = await resolveIntakeSlash(['replay', 'intake-old'], {
      store,
      now: () => new Date('2026-04-30T13:00:00.000Z'),
      createIntakeId: () => 'intake-new',
    });
    expect(result.output).toContain('/intake replay: intake-old -> intake-new');
    expect(store.getSession('intake-new')?.raw.rawText).toBe('compare two repos');
    expect(store.getSession('intake-new')?.state).toBe('review-ready');
  });

  test('archive archives the latest session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    const result = await resolveIntakeSlash(['archive'], { store });
    expect(result.output).toContain('intake-fixed archived');
    expect(store.getSession('intake-fixed')?.state).toBe('archived');
  });

  test('events renders the lifecycle event log for a session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'compare', 'two', 'repos'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
    });
    await resolveIntakeSlash(['decide', 'backlog-only'], { store });
    const result = await resolveIntakeSlash(['events'], { store });
    expect(result.output).toContain('Intake events: intake-fixed');
    expect(result.output).toContain('captured');
    expect(result.output).toContain('draft-saved');
    expect(result.output).toContain('decision-saved');
  });

  test('draft rejects an empty scratch note', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await resolveIntakeSlash(['draft'], {
      store,
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: [],
      }),
    });
    expect(result.output).toContain('scratch note is empty');
  });

  test('implement translates each enriched task into an isolated research-aware harness ask', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'implement researched task'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
    });
    const launched: string[] = [];
    const enriched: EnrichedDecomposition = {
      fallback: false,
      rationale: 'test research-aware task launch',
      missions: [{ id: 'm-1', title: 'Mission', tasks: [
        {
          id: 't-1', title: 'Research launch', intent: 'Forward prior research', refs: ['src/intake-plane/slash.ts'],
          keywords: ['harness research'], urls: ['https://example.test/launch'], confidence: 'high', invariants: [{ condition: 'slash.ts 의 기존 서브커맨드를 바꾸지 않는다', verification: 'src/intake-plane/slash.ts 의 분기를 읽는다', expected: '기존 동작이 남아 있다' }], decisionSignals: [{ condition: '리서치 문맥이 자식 ask 에 실린다', observation: '낸 ask 의 keywords 원소 수를 센다', expected: '1 이상이다' }], 
          context: { enrichments: [{ kind: 'keyword', source: 'harness research', fetchedAt: '2026-08-31T00:00:00.000Z', summary: 'Launch only after using this research.' }] },
        },
        {
          id: 't-2', title: 'Sibling launch', intent: 'Keep research isolated', refs: ['src/intake-plane/enrich.ts'],
          keywords: ['sibling research'], urls: ['https://example.test/sibling'], confidence: 'high', invariants: [{ condition: 'enrich.ts 의 기존 심을 바꾸지 않는다', verification: 'src/intake-plane/enrich.ts 의 plugins 계약을 읽는다', expected: '기존 동작이 남아 있다' }], decisionSignals: [{ condition: '형제 리서치가 섞이지 않는다', observation: '낸 ask 의 keywords 원소 수를 센다', expected: '1 이상이다' }], 
          context: { enrichments: [{ kind: 'url', source: 'https://example.test/sibling', fetchedAt: '2026-08-31T00:00:00.000Z', summary: 'Sibling research must not leak.' }] },
        },
      ] }],
    };
    const result = await resolveIntakeSlash(['implement'], {
      store,
      runPipeline: async () => ({ enriched }),
      // ⛔⭐ 실제 심은 `dispatchHarness({ objective }, ctx) => { output }` 이다.
      //   📏 2026-08-31: 두 골이 같은 축에 «두 어휘»를 지어(launchHarnessAsk ↔ dispatchHarness)
      //     시험이 «없는 심»을 주고 있었다 — 각자 게이트는 초록, main 에서만 2 fail.
      dispatchHarness: async ({ objective }) => { launched.push(objective); return { output: 'ok' }; },
    });
    expect(result.output).toContain('launched 2/2 independent harness goals');
    expect(launched).toHaveLength(2);
    expect(launched[0]).toContain('harness research');
    expect(launched[0]).toContain('https://example.test/launch');
    expect(launched[0]).toContain('Launch only after using this research.');
    expect(launched[0]).not.toContain('Sibling research must not leak.');
    expect(launched[1]).toContain('sibling research');
    expect(launched[1]).toContain('https://example.test/sibling');
    expect(launched[1]).toContain('Sibling research must not leak.');
    expect(launched[1]).not.toContain('Launch only after using this research.');
  });

  test('implement runs the default decompose and enrich phases before launching task-local research', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['capture', 'implement research-aware launch'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-default-pipeline',
    });
    const launched: string[] = [];
    const result = await resolveIntakeSlash(['implement'], {
      store,
      pipelineCallables: {
        decompose: async () => ({ text: JSON.stringify({
          rationale: 'two isolated researched tasks',
          missions: [{ id: 'm-1', title: 'Mission', tasks: [
            { id: 't-1', title: 'First', intent: 'Use first research', refs: ['src/first.ts'], invariants: [{ condition: '기존 파이프라인 단계 순서를 바꾸지 않는다', verification: 'src/intake-plane/pipeline-runner.ts 의 단계 목록을 읽는다', expected: '단계가 모두 남아 있다' }], decisionSignals: [{ condition: '작업별 리서치가 격리된다', observation: '각 ask 안의 keywords 원소 수를 센다', expected: '1 이상이다' }], keywords: ['first-keyword'], urls: ['https://example.test/first'], confidence: 'high' },
            { id: 't-2', title: 'Second', intent: 'Use second research', refs: ['src/second.ts'], invariants: [{ condition: '기존 파이프라인 단계 순서를 바꾸지 않는다', verification: 'src/intake-plane/pipeline-runner.ts 의 단계 목록을 읽는다', expected: '단계가 모두 남아 있다' }], decisionSignals: [{ condition: '작업별 리서치가 격리된다', observation: '각 ask 안의 keywords 원소 수를 센다', expected: '1 이상이다' }], keywords: ['second-keyword'], urls: ['https://example.test/second'], confidence: 'high' },
          ] }],
        }) }),
        enrichPlugins: {
          digestUrl: async ({ url }) => ({ summary: `researched ${url}` }),
          crawlKeyword: async ({ keyword }) => ({ summary: `researched ${keyword}` }),
        },
      },
      // ⛔⭐ 실제 심은 `dispatchHarness({ objective }, ctx) => { output }` 이다.
      //   📏 2026-08-31: 두 골이 같은 축에 «두 어휘»를 지어(launchHarnessAsk ↔ dispatchHarness)
      //     시험이 «없는 심»을 주고 있었다 — 각자 게이트는 초록, main 에서만 2 fail.
      dispatchHarness: async ({ objective }) => { launched.push(objective); return { output: 'ok' }; },
    });
    expect(result.output).toContain('launched 2/2 independent harness goals');
    expect(launched).toHaveLength(2);
    expect(launched[0]).toContain('first-keyword');
    expect(launched[0]).toContain('researched https://example.test/first');
    expect(launched[0]).not.toContain('second-keyword');
    expect(launched[0]).not.toContain('researched https://example.test/second');
    expect(launched[1]).toContain('second-keyword');
    expect(launched[1]).toContain('researched https://example.test/second');
    expect(launched[1]).not.toContain('first-keyword');
    expect(launched[1]).not.toContain('researched https://example.test/first');
  });

  test('propose stores a TOX apply token on the intake session', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    const result = await resolveIntakeSlash(['propose'], { store });
    expect(result.output).toContain('TaskDecompose');
    expect(store.getSession('intake-fixed')?.state).toBe('proposed');
    expect(store.getSession('intake-fixed')?.applyToken).toBeTruthy();
  });

  test('apply consumes the stored TOX token and marks the intake applied', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    await resolveIntakeSlash(['propose'], { store });
    const result = await resolveIntakeSlash(['apply'], { store });
    expect(result.output).toContain('TaskDecomposeApply');
    expect(store.getSession('intake-fixed')?.state).toBe('applied');
    expect(graph.size()).toBe(1);
  });

  test('apply auto-proposes when a review-ready draft has no token yet', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    const result = await resolveIntakeSlash(['apply'], { store });
    expect(result.output).toContain('TaskDecomposeApply');
    expect(store.getSession('intake-fixed')?.state).toBe('applied');
    expect(graph.size()).toBe(1);
  });

  test('apply refuses auto-propose when clarifying questions remain', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['ambiguous free note without clear action'],
      }),
    });
    const result = await resolveIntakeSlash(['apply'], { store });
    expect(result.output).toContain('open questions');
    expect(graph.size()).toBe(0);
  });

  test('answer resolves a clarify question into backlog-only and blocks apply', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['ambiguous free note without clear action'],
      }),
    });
    const answered = await resolveIntakeSlash(['answer', 'q-unknown', 'keep', 'this', 'as', 'backlog'], { store });
    expect(answered.output).toContain('backlog-only');
    expect(store.getSession('intake-fixed')?.state).toBe('review-ready');
    expect(store.getSession('intake-fixed')?.decision?.mode).toBe('backlog-only');
    const applied = await resolveIntakeSlash(['apply'], { store });
    expect(applied.output).toContain('backlog-only');
  });

  test('answer shorthand resolves the only clarify question by intake id', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['===='],
      }),
    });
    const answered = await resolveIntakeSlash(['answer', 'intake-fixed', 'keep', 'this', 'as', 'backlog'], { store });
    expect(answered.output).toContain('backlog-only');
    expect(store.getSession('intake-fixed')?.decision?.mode).toBe('backlog-only');
  });

  test('answer shorthand resolves the latest clarify question without ids', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['===='],
      }),
    });
    const answered = await resolveIntakeSlash(['answer', 'keep', 'this', 'as', 'backlog'], { store });
    expect(answered.output).toContain('backlog-only');
    expect(store.getSession('intake-fixed')?.decision?.mode).toBe('backlog-only');
  });

  test('answer resolves a clarify question into apply-now and unlocks apply', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => makeGenerator({
        rationale: 'split work',
        tasks: [{ index: 0, title: 'Investigate', surface: surfaceLlm }],
      }),
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['ambiguous free note without clear action'],
      }),
    });
    const answered = await resolveIntakeSlash(['answer', 'q-unknown', 'create', 'tasks', 'now'], { store });
    expect(answered.output).toContain('apply-now');
    expect(store.getSession('intake-fixed')?.state).toBe('review-ready');
    const applied = await resolveIntakeSlash(['apply'], { store });
    expect(applied.output).toContain('TaskDecomposeApply');
    expect(graph.size()).toBe(1);
  });

  test('decide backlog-only prevents propose/apply on review-ready sessions', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- compare two repos'],
      }),
    });
    const decided = await resolveIntakeSlash(['decide', 'backlog-only'], { store });
    expect(decided.output).toContain('backlog-only');
    const proposed = await resolveIntakeSlash(['propose'], { store });
    expect(proposed.output).toContain('marked backlog-only');
    const applied = await resolveIntakeSlash(['apply'], { store });
    expect(applied.output).toContain('marked backlog-only');
  });

  test('list supports source filtering', async () => {
    const store = createIntakeStore({ archiveDir: null });
    store.capture({
      intakeId: 'intake-voice',
      source: 'voice',
      rawText: 'compare two repos',
      attachments: [],
      transcriptSource: 'voice',
      receivedAt: '2026-04-30T12:00:00.000Z',
    });
    store.capture({
      intakeId: 'intake-api',
      source: 'api',
      rawText: 'compare widgets',
      attachments: [],
      receivedAt: '2026-04-30T12:01:00.000Z',
    });
    const result = await resolveIntakeSlash(['list', 'source:voice'], { store });
    expect(result.output).toContain('intake-voice');
    expect(result.output).not.toContain('intake-api');
  });

  test('schedule + apply creates a scheduled TOX task directly', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const graph = new TaskGraph();
    const dispatcher = new TaskDispatcher({
      graph,
      registry: new SurfaceRegistry(),
      bus: new TaskEventBus(),
    });
    setToxRuntimeDeps({
      getGraph: () => graph,
      getDispatcher: () => dispatcher,
      getGenerator: () => null,
    });
    await resolveIntakeSlash(['draft'], {
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-fixed',
      getScratchSnapshot: () => ({
        title: 'Scratch',
        lines: ['- check screen recording source'],
      }),
    });
    const scheduled = await resolveIntakeSlash(['schedule', '30m'], { store });
    expect(scheduled.output).toContain('scheduled as "30m"');
    const applied = await resolveIntakeSlash(['apply'], { store });
    expect(applied.output).toContain('scheduled via 30m');
    expect(store.getSession('intake-fixed')?.state).toBe('scheduled');
    const tasks = graph.listAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('scheduled');
    expect(tasks[0]?.scheduleText).toBe('30m');
    expect(tasks[0]?.schedulerJobId).toBeTruthy();
  });
});
