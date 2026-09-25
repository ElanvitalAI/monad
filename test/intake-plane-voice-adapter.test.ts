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
  createVoiceIntakeRecord,
  ingestVoiceTranscript,
  renderVoiceIntakeSummary,
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

describe('voice intake adapter', () => {
  test('creates a voice-sourced raw intake record', () => {
    const record = createVoiceIntakeRecord({
      intakeId: 'voice-1',
      transcript: 'compare two repos',
      receivedAt: '2026-04-30T12:00:00.000Z',
      actor: { id: 'u1', display: 'Alice' },
      channelContext: { deviceId: 'mic-1' },
    });
    expect(record.source).toBe('voice');
    expect(record.transcriptSource).toBe('voice');
    expect(record.channelContext?.deviceId).toBe('mic-1');
  });

  test('ingests a ready voice transcript and renders a review summary', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await ingestVoiceTranscript(store, {
      intakeId: 'voice-ready',
      transcript: 'compare two repos and inspect the widget issue',
      receivedAt: '2026-04-30T12:00:00.000Z',
    });
    expect(result.state).toBe('review-ready');
    expect(renderVoiceIntakeSummary(result)).toContain("It's ready for review.");
  });

  test('ingests an ambiguous voice transcript and asks for clarification', async () => {
    const store = createIntakeStore({ archiveDir: null });
    const result = await ingestVoiceTranscript(store, {
      intakeId: 'voice-clarify',
      transcript: 'ambiguous free note without clear action',
      receivedAt: '2026-04-30T12:00:00.000Z',
    });
    expect(result.state).toBe('clarifying');
    const summary = renderVoiceIntakeSummary(result);
    expect(summary).toContain('I still need one clarification');
    expect(summary).toContain('You can say: intake answer voice-clarify <answer...>.');
  });

  test('supports apply-now voice ingestion', async () => {
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
    const result = await ingestVoiceTranscript(
      store,
      {
        intakeId: 'voice-now',
        transcript: 'compare two repos',
        receivedAt: '2026-04-30T12:00:00.000Z',
      },
      { mode: 'apply-now' },
    );
    expect(result.state).toBe('applied');
    expect(renderVoiceIntakeSummary(result)).toContain('already been turned into tasks');
    expect(graph.size()).toBe(1);
  });
});
