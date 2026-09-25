// W5 Z5 · post-run retro showroom · collect → cascade → KGS write-back.

import { describe, expect, test } from 'bun:test';
import {
  collectRetroRecord,
  runPostRunShowroom,
  type KgsRetroWriter,
  type RetroCard,
} from '../../src/workflow-runtime/post-run-showroom';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';
import type { WorkflowEvent } from '../../src/workflow-runtime/types';

async function* feed(events: WorkflowEvent[]): AsyncIterable<WorkflowEvent> {
  for (const e of events) yield e;
}

function makeWriter(): KgsRetroWriter & { written: RetroCard[] } {
  const written: RetroCard[] = [];
  return {
    written,
    writeRetroCard: async (c) => { written.push(c); },
  };
}

function fakeCallable(answers: Record<string, string>): ShowroomLaneCallable {
  return async (input) => ({ text: answers[input.role] ?? `${input.role}-out`, modelId: input.model });
}

describe('collectRetroRecord', () => {
  test('captures workflow_done outputs', async () => {
    const events: WorkflowEvent[] = [
      { type: 'workflow_start', workflow: 'wf1', runId: 'r1' },
      { type: 'node_start', nodeId: 'a', nodeType: 'prompt' },
      { type: 'node_done', nodeId: 'a', result: { output: 'hi', ok: true, durationMs: 12 } },
      { type: 'workflow_done', outputs: { a: { output: 'hi', ok: true, durationMs: 12 } } },
    ];
    const rec = await collectRetroRecord(feed(events), {
      runId: 'r1', workflowName: 'wf1', startedAt: 100, now: () => 250,
    });
    expect(rec.ok).toBe(true);
    expect(rec.error).toBeUndefined();
    expect(rec.outputs.a!.output).toBe('hi');
    expect(rec.completedAt - rec.startedAt).toBe(150);
    expect(rec.events.length).toBe(4);
  });

  test('captures workflow_failed partial + error', async () => {
    const events: WorkflowEvent[] = [
      { type: 'workflow_start', workflow: 'wf2', runId: 'r2' },
      { type: 'node_skipped', nodeId: 'b', reason: 'dep failed' },
      { type: 'workflow_failed', error: 'node a crashed', partial: { a: { output: 'oops', ok: false, durationMs: 5 } } },
    ];
    const rec = await collectRetroRecord(feed(events), { runId: 'r2', workflowName: 'wf2', startedAt: 0, now: () => 60 });
    expect(rec.ok).toBe(false);
    expect(rec.error).toBe('node a crashed');
    expect(rec.outputs.a!.ok).toBe(false);
  });
});

describe('runPostRunShowroom', () => {
  test('opt-out returns null without invoking lanes or writer', async () => {
    let called = 0;
    const callable: ShowroomLaneCallable = async () => { called++; return { text: 'x' }; };
    const writer = makeWriter();
    const out = await runPostRunShowroom(
      {
        runId: 'r1', workflowName: 'w', ok: true, startedAt: 0, completedAt: 1,
        events: [], outputs: {},
      },
      { laneCallable: callable, kgsWriter: writer, enabled: () => false },
    );
    expect(out).toBeNull();
    expect(called).toBe(0);
    expect(writer.written.length).toBe(0);
  });

  test('opt-in fires 3 lanes (reflect → review → plan) and writes card', async () => {
    const callable = fakeCallable({
      reflect: 'Run completed successfully.',
      review: '- ship faster\n- review smaller PRs\n- chunk logs',
      plan: '1. Add metrics\n2. Cache results\n3. Pre-warm pool',
    });
    const writer = makeWriter();
    const card = await runPostRunShowroom(
      {
        runId: 'r1', workflowName: 'wfX', ok: true, startedAt: 0, completedAt: 200,
        events: [{ type: 'workflow_done', outputs: {} }], outputs: {},
      },
      { laneCallable: callable, kgsWriter: writer, enabled: () => true, now: () => 500 },
    );
    expect(card).not.toBeNull();
    expect(card!.summary).toBe('Run completed successfully.');
    expect(card!.lessons).toEqual(['ship faster', 'review smaller PRs', 'chunk logs']);
    expect(card!.improvements).toEqual(['Add metrics', 'Cache results', 'Pre-warm pool']);
    expect(card!.createdAt).toBe(500);
    expect(card!.transcript).toContain('## reflect');
    expect(card!.transcript).toContain('## plan');
    expect(writer.written.length).toBe(1);
    expect(writer.written[0]!.runId).toBe('r1');
  });

  test('threads reflect output into lessons + improvements prompts', async () => {
    const seenPrompts: Record<string, string> = {};
    const callable: ShowroomLaneCallable = async (input) => {
      seenPrompts[input.role] = input.prompt;
      return { text: `${input.role}-text` };
    };
    await runPostRunShowroom(
      {
        runId: 'r', workflowName: 'w', ok: false, startedAt: 0, completedAt: 1,
        events: [], outputs: {}, error: 'boom',
      },
      { laneCallable: callable, kgsWriter: makeWriter(), enabled: () => true },
    );
    expect(seenPrompts.reflect).toContain('failed (boom)');
    expect(seenPrompts.review).toContain('Prior summary:\nreflect-text');
    expect(seenPrompts.plan).toContain('Lessons:\nreview-text');
  });

  test('model pins override defaults', async () => {
    const seenModels: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seenModels.push(input.model);
      return { text: 'x' };
    };
    await runPostRunShowroom(
      {
        runId: 'r', workflowName: 'w', ok: true, startedAt: 0, completedAt: 1,
        events: [], outputs: {},
      },
      {
        laneCallable: callable, kgsWriter: makeWriter(), enabled: () => true,
        models: { reflect: 'gpt-4', lessons: 'claude-opus', improvements: 'gemini-pro' },
      },
    );
    expect(seenModels).toEqual(['gpt-4', 'claude-opus', 'gemini-pro']);
  });

  test('writer rejection propagates', async () => {
    const callable: ShowroomLaneCallable = async () => ({ text: 'x' });
    const failingWriter: KgsRetroWriter = {
      writeRetroCard: async () => { throw new Error('disk full'); },
    };
    await expect(runPostRunShowroom(
      {
        runId: 'r', workflowName: 'w', ok: true, startedAt: 0, completedAt: 1,
        events: [], outputs: {},
      },
      { laneCallable: callable, kgsWriter: failingWriter, enabled: () => true },
    )).rejects.toThrow(/disk full/);
  });
});
