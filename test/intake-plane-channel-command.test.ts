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
import { createIntakeStore, handleTextChannelIntakeCommand } from '../src/intake-plane/index.js';

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

describe('handleTextChannelIntakeCommand', () => {
  test('captures inline text by default in review mode', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const out = await handleTextChannelIntakeCommand(['compare', 'two', 'repos'], {
      surface: 'telegram',
      source: 'telegram',
      text: '/intake compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-inline',
      actor: { id: '42', display: 'alice' },
      channelContext: { chatId: '42' },
    });
    expect(out).toContain('Intake: intake-inline [review-ready]');
    expect(out).toContain('- /intake decide apply-now intake-inline');
  });

  test('now shorthand auto-applies when the draft is ready', async () => {
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
    const out = await handleTextChannelIntakeCommand(['now', 'compare', 'two', 'repos'], {
      surface: 'discord',
      source: 'discord',
      text: '!intake now compare two repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-now',
      actor: { id: 'u1', display: 'Alice' },
      channelContext: { chatId: 'c1', guildId: 'g1' },
    });
    expect(out).toContain('Intake: intake-now [applied]');
    expect(out).toContain('TaskDecomposeApply');
    expect(graph.size()).toBe(1);
  });

  test('when shorthand creates a scheduled task', async () => {
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
    const out = await handleTextChannelIntakeCommand(['when', '30m', '--', 'check', 'screen', 'recording'], {
      surface: 'telegram',
      source: 'telegram',
      text: '/intake when 30m -- check screen recording',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-when',
      channelContext: { chatId: '42' },
    });
    expect(out).toContain('Intake: intake-when [scheduled]');
    expect(out).toContain('scheduled via 30m');
    expect(graph.listAll()[0]?.status).toBe('scheduled');
  });

  test('delegates existing session subcommands to resolveIntakeSlash', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await handleTextChannelIntakeCommand(['ambiguous', 'free', 'note', 'without', 'clear', 'action'], {
      surface: 'discord',
      source: 'discord',
      text: '!intake ambiguous free note without clear action',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-q',
      channelContext: { chatId: 'c1' },
    });
    const out = await handleTextChannelIntakeCommand(['answer', 'q-unknown', 'keep', 'as', 'backlog', 'intake-q'], {
      surface: 'discord',
      source: 'discord',
      text: '!intake answer q-unknown keep as backlog intake-q',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      channelContext: { chatId: 'c1' },
    });
    expect(out).toContain('backlog-only');
    expect(store.getSession('intake-q')?.decision?.mode).toBe('backlog-only');
  });

  test('accepts shorthand answer syntax when only one clarify question is open', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const opened = await handleTextChannelIntakeCommand(['===='], {
      surface: 'telegram',
      source: 'telegram',
      text: '/intake ====',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-shorthand',
      channelContext: { chatId: '42' },
    });
    expect(opened).toContain('/intake answer <answer...>');
    const out = await handleTextChannelIntakeCommand(['answer', 'intake-shorthand', 'keep', 'this', 'in', 'backlog'], {
      surface: 'telegram',
      source: 'telegram',
      text: '/intake answer intake-shorthand keep this in backlog',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      channelContext: { chatId: '42' },
    });
    expect(out).toContain('backlog-only');
    expect(store.getSession('intake-shorthand')?.decision?.mode).toBe('backlog-only');
  });

  test('accepts latest-intake answer shorthand without question or intake ids', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await handleTextChannelIntakeCommand(['===='], {
      surface: 'discord',
      source: 'discord',
      text: '!intake ====',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-latest',
      channelContext: { chatId: 'c1' },
    });
    const out = await handleTextChannelIntakeCommand(['answer', 'keep', 'this', 'in', 'backlog'], {
      surface: 'discord',
      source: 'discord',
      text: '!intake answer keep this in backlog',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      channelContext: { chatId: 'c1' },
    });
    expect(out).toContain('backlog-only');
    expect(store.getSession('intake-latest')?.decision?.mode).toBe('backlog-only');
  });

  test('carries normalized attachments into captured intake records', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await handleTextChannelIntakeCommand(['compare', 'diagram', 'repos'], {
      surface: 'telegram',
      source: 'telegram',
      text: '/intake compare diagram repos',
      store,
      now: () => new Date('2026-04-30T12:00:00.000Z'),
      createIntakeId: () => 'intake-att',
      attachments: [
        {
          kind: 'photo',
          name: 'diagram.png',
          localPath: '/tmp/diagram.png',
          mimeType: 'image/png',
          width: 800,
          height: 600,
        },
      ],
      channelContext: { chatId: '42' },
    });
    const session = store.getSession('intake-att');
    expect(session?.raw.attachments).toHaveLength(1);
    expect(session?.raw.attachments[0]?.name).toBe('diagram.png');
  });
});
