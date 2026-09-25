import { afterEach, describe, expect, test } from 'bun:test';
import { TaskDispatcher } from '../src/task-orchestrator/dispatcher.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { TaskGenerator, type DecomposeCallable } from '../src/task-orchestrator/generator.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  clearPendingDecomposeForTest,
  resetToxRuntimeDepsForTest,
  setToxRuntimeDeps,
} from '../src/task-orchestrator/runtime-deps.ts';
import { SurfaceRegistry } from '../src/task-orchestrator/surface-registry.ts';
import type { TaskSurface } from '../src/task-orchestrator/types.ts';
import {
  createApiIntakeRecord,
  createIntakeStore,
  createTextChannelIntakeRecord,
  ingestIntakeRecord,
} from '../src/intake-plane/index.js';

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

describe('ingestIntakeRecord', () => {
  test('review mode captures a text-channel intake without applying', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await ingestIntakeRecord(
      store,
      createTextChannelIntakeRecord({
        intakeId: 'intake-discord',
        source: 'discord',
        text: '- compare two repos',
        receivedAt: '2026-04-30T12:00:00.000Z',
        actor: { id: 'u1', display: 'Alice' },
        channelContext: { chatId: 'discord:chan:1' },
      }),
    );
    expect(result.state).toBe('review-ready');
    expect(result.output).toContain('ready for review');
    expect(result.session.raw.channelContext?.chatId).toBe('discord:chan:1');
    expect(result.session.raw.inputSourceKind).toBe('discord');
    expect(result.session.raw.inputSource).toEqual({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      channelId: 'discord:chan:1',
      guildId: undefined,
      userId: 'u1',
      entry: 'text',
      relay: 'native-bot',
    });
  });

  test('apply-now mode auto-applies review-ready intakes', async () => {
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
    const result = await ingestIntakeRecord(
      store,
      createApiIntakeRecord({
        intakeId: 'intake-api',
        text: '- compare two repos',
        receivedAt: '2026-04-30T12:00:00.000Z',
      }),
      { mode: 'apply-now' },
    );
    expect(result.state).toBe('applied');
    expect(result.output).toContain('TaskDecomposeApply');
    expect(result.taskIds).toHaveLength(1);
    expect(graph.size()).toBe(1);
    expect(result.session.raw.inputSourceKind).toBe('daemon-api');
  });

  test('apply-now mode stops at clarifying when questions remain', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await ingestIntakeRecord(
      store,
      createApiIntakeRecord({
        intakeId: 'intake-ambiguous',
        text: 'ambiguous free note without clear action',
        receivedAt: '2026-04-30T12:00:00.000Z',
      }),
      { mode: 'apply-now' },
    );
    expect(result.state).toBe('clarifying');
    expect(result.output).toContain('needs clarification');
  });

  test('backlog-only mode preserves the draft without TOX handoff', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await ingestIntakeRecord(
      store,
      createApiIntakeRecord({
        intakeId: 'intake-backlog',
        text: '- compare two repos',
        receivedAt: '2026-04-30T12:00:00.000Z',
      }),
      { mode: 'backlog-only' },
    );
    expect(result.state).toBe('review-ready');
    expect(result.session.decision?.mode).toBe('backlog-only');
    expect(result.output).toContain('backlog-only');
  });

  test('schedule-followup mode creates a scheduled TOX task', async () => {
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
    const result = await ingestIntakeRecord(
      store,
      createApiIntakeRecord({
        intakeId: 'intake-scheduled',
        text: '- check screen recording source',
        receivedAt: '2026-04-30T12:00:00.000Z',
      }),
      { mode: 'schedule-followup', scheduleText: '30m' },
    );
    expect(result.state).toBe('scheduled');
    expect(result.output).toContain('scheduled via 30m');
    expect(result.taskId).toBeTruthy();
    expect(graph.listAll()[0]?.status).toBe('scheduled');
  });
});
