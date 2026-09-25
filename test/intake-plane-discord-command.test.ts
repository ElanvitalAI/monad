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
  createIntakeStore,
  maybeHandleDiscordIntakeMessage,
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

describe('maybeHandleDiscordIntakeMessage', () => {
  test('returns null for non-intake messages', async () => {
    const reply = await maybeHandleDiscordIntakeMessage(
      {
        text: 'hello',
        channelId: 'C1',
        userId: 'U1',
        attachments: [],
      },
      {
        downloadAttachment: async () => ({ localPath: '/tmp/x', fileName: 'x' }),
      },
    );
    expect(reply).toBeNull();
  });

  test('captures review-mode inline intake from a discord text message', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const reply = await maybeHandleDiscordIntakeMessage(
      {
        text: '!intake compare two repos',
        channelId: 'C1',
        userId: 'U1',
        userName: 'alice',
        guildId: 'G1',
        attachments: [],
      },
      {
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        createIntakeId: () => 'intake-discord',
        downloadAttachment: async () => ({ localPath: '/tmp/x', fileName: 'x' }),
      },
    );
    expect(reply).toContain('Intake: intake-discord [review-ready]');
    expect(reply).toContain('!intake decide apply-now intake-discord');
  });

  test('passes normalized attachments into the intake bundle', async () => {
    const store = createIntakeStore({ archiveDir: null });
    await maybeHandleDiscordIntakeMessage(
      {
        text: '!intake compare screenshots',
        channelId: 'C1',
        userId: 'U1',
        attachments: [
          {
            id: 'a1',
            filename: 'shot.png',
            size: 4096,
            url: 'https://cdn.discord.local/shot.png',
            contentType: 'image/png',
            width: 1280,
            height: 720,
          },
        ],
      },
      {
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        createIntakeId: () => 'intake-att',
        downloadAttachment: async () => ({
          localPath: '/tmp/shot.png',
          fileName: 'shot.png',
        }),
      },
    );
    const session = store.getSession('intake-att');
    expect(session?.raw.attachments).toHaveLength(1);
    expect(session?.raw.attachments[0]).toMatchObject({
      kind: 'photo',
      name: 'shot.png',
      mimeType: 'image/png',
    });
  });

  test('supports !intake now auto-apply shorthand', async () => {
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
    const reply = await maybeHandleDiscordIntakeMessage(
      {
        text: '!intake now compare two repos',
        channelId: 'C1',
        userId: 'U1',
        attachments: [],
      },
      {
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        createIntakeId: () => 'intake-now',
        downloadAttachment: async () => ({ localPath: '/tmp/x', fileName: 'x' }),
      },
    );
    expect(reply).toContain('TaskDecomposeApply');
    expect(graph.size()).toBe(1);
  });

  test('supports !intake answer shorthand against the latest clarify intake', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const opened = await maybeHandleDiscordIntakeMessage(
      {
        text: '!intake ====',
        channelId: 'C1',
        userId: 'U1',
        attachments: [],
      },
      {
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        createIntakeId: () => 'intake-discord-clarify',
        downloadAttachment: async () => ({ localPath: '/tmp/x', fileName: 'x' }),
      },
    );
    expect(opened).toContain('!intake answer <answer...>');
    const reply = await maybeHandleDiscordIntakeMessage(
      {
        text: '!intake answer keep this in backlog',
        channelId: 'C1',
        userId: 'U1',
        attachments: [],
      },
      {
        store,
        now: () => new Date('2026-04-30T12:00:00.000Z'),
        downloadAttachment: async () => ({ localPath: '/tmp/x', fileName: 'x' }),
      },
    );
    expect(reply).toContain('backlog-only');
    expect(store.getSession('intake-discord-clarify')?.decision?.mode).toBe('backlog-only');
  });
});
