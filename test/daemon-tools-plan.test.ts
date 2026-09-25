// Opportunistic followup §6.2 #4 (2026-05-13) — `Plan` + `MarkStepDone`
// daemon tool tests. Owns the wire contract that PWA `<PlanBlock>`
// renderer (M3 PR #2483) depends on.
//
// Invariants under test:
//  1. Plan() with N steps emits phase=start envelope · activeIndex=0
//     · all steps pending · blockId = `<sid>:plan:<ref>`.
//  2. MarkStepDone(i) emits phase=update · step[i].status flips ·
//     activeIndex advances to next pending.
//  3. Marking the last step flips phase to 'end' and clears the
//     module-level active plan (subsequent MarkStepDone refuses).
//  4. MarkStepDone with `status: 'skipped'` flips to skipped — not
//     done.
//  5. Out-of-range stepIndex throws ToolSafetyError.
//  6. MarkStepDone without prior Plan throws ToolSafetyError.
//  7. Without ctx.sessionId, Plan returns a result but emits 0
//     envelopes (no renderer to bind blockId to).
//  8. Re-issuing Plan(...) replaces the active plan + new blockId.
//  9. blockId stable + seq monotonic across all envelopes for one plan.
// 10. emitFeedback throw is swallowed — dispatch still resolves.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  dispatchMarkStepDone,
  dispatchPlan,
  _resetActivePlansForTests,
} from '../src/boot/daemon-tools/plan.js';
import {
  ToolSafetyError,
  type DaemonToolDispatchCtx,
} from '../src/boot/daemon-tools/types.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

interface PlanPayload {
  ref: string;
  steps: Array<{ text: string; status: string }>;
  activeIndex?: number;
}

beforeEach(() => {
  _resetActivePlansForTests();
});

afterEach(() => {
  _resetActivePlansForTests();
});

function makeCtx(
  overrides: Partial<DaemonToolDispatchCtx> = {},
): DaemonToolDispatchCtx {
  return {
    cwd: '/tmp',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeCollector(): {
  envelopes: FeedbackEnvelope[];
  emit: (env: FeedbackEnvelope) => void;
} {
  const envelopes: FeedbackEnvelope[] = [];
  return { envelopes, emit: (env) => envelopes.push(env) };
}

describe('dispatchPlan · happy path', () => {
  test('emits phase=start envelope with the step list (all pending)', async () => {
    const { envelopes, emit } = makeCollector();
    const r = await dispatchPlan(
      { steps: [{ text: 'Read the file' }, { text: 'Edit the function' }, { text: 'Run tests' }] },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    expect(r.steps).toEqual([
      { text: 'Read the file', status: 'pending' },
      { text: 'Edit the function', status: 'pending' },
      { text: 'Run tests', status: 'pending' },
    ]);
    expect(r.activeIndex).toBe(0);
    expect(envelopes).toHaveLength(1);
    const env = envelopes[0]!;
    expect(env.kind).toBe('agent.plan');
    expect(env.phase).toBe('start');
    expect(env.blockId).toBe(`s-1:plan:${r.ref}`);
    const payload = env.payload as PlanPayload;
    expect(payload.activeIndex).toBe(0);
    expect(payload.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  test('Plan without ctx.sessionId still returns plan but emits zero envelopes', async () => {
    const { envelopes, emit } = makeCollector();
    const r = await dispatchPlan(
      { steps: [{ text: 'A' }] },
      makeCtx({ emitFeedback: emit /* no sessionId */ }),
    );
    expect(r.steps).toHaveLength(1);
    expect(envelopes).toEqual([]);
  });

  test('parentToolCallId propagated when ctx.toolCallId provided', async () => {
    const { envelopes, emit } = makeCollector();
    await dispatchPlan(
      { steps: [{ text: 'A' }] },
      makeCtx({ emitFeedback: emit, sessionId: 's-1', toolCallId: 'tc-7' }),
    );
    expect(envelopes[0]!.parentToolCallId).toBe('tc-7');
  });
});

describe('dispatchMarkStepDone · happy path', () => {
  test('marks step done and emits phase=update with advancing activeIndex', async () => {
    const { envelopes, emit } = makeCollector();
    const ctx = makeCtx({ emitFeedback: emit, sessionId: 's-1' });
    await dispatchPlan(
      { steps: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] },
      ctx,
    );
    const r1 = await dispatchMarkStepDone({ stepIndex: 0 }, ctx);
    expect(r1.steps[0]!.status).toBe('done');
    expect(r1.steps[1]!.status).toBe('pending');
    expect(r1.activeIndex).toBe(1);
    const updateEnv = envelopes[envelopes.length - 2]!;
    expect(updateEnv.kind).toBe('agent.plan');
    expect(updateEnv.phase).toBe('update');
    expect(updateEnv.blockId).toBe(envelopes[0]!.blockId);
    const payload = updateEnv.payload as PlanPayload;
    expect(payload.steps[0]!.status).toBe('done');
    expect(payload.activeIndex).toBe(1);
    const stepEnv = envelopes[envelopes.length - 1]!;
    expect(stepEnv.kind).toBe('tool.progress');
    expect(stepEnv.phase).toBe('update');
    expect(stepEnv.blockId).toBe(updateEnv.blockId);
    expect(stepEnv.asciiFallback).toEqual([]);
    expect(stepEnv.payload).toMatchObject({
      stream: 'generic',
      lines: [],
      stepId: `${r1.ref}:0:A`,
    });
  });

  test('marking the last step flips envelope to phase=end + clears active plan', async () => {
    const { envelopes, emit } = makeCollector();
    const ctx = makeCtx({ emitFeedback: emit, sessionId: 's-1' });
    await dispatchPlan({ steps: [{ text: 'only' }] }, ctx);
    const r = await dispatchMarkStepDone({ stepIndex: 0 }, ctx);
    expect(r.steps[0]!.status).toBe('done');
    expect(r.activeIndex).toBe(1); // past the last step
    const endEnv = envelopes[envelopes.length - 2]!;
    expect(endEnv.kind).toBe('agent.plan');
    expect(endEnv.phase).toBe('end');
    // Subsequent MarkStepDone refuses (active plan cleared).
    await expect(
      dispatchMarkStepDone({ stepIndex: 0 }, ctx),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('status: "skipped" flips step.status to skipped (not done)', async () => {
    const { envelopes, emit } = makeCollector();
    const ctx = makeCtx({ emitFeedback: emit, sessionId: 's-1' });
    await dispatchPlan({ steps: [{ text: 'A' }, { text: 'B' }] }, ctx);
    const r = await dispatchMarkStepDone({ stepIndex: 0, status: 'skipped' }, ctx);
    expect(r.steps[0]!.status).toBe('skipped');
    const env = envelopes[envelopes.length - 2]!;
    expect(env.kind).toBe('agent.plan');
    const payload = env.payload as PlanPayload;
    expect(payload.steps[0]!.status).toBe('skipped');
  });

  test('blockId stable + seq monotonic across start + multiple updates', async () => {
    const { envelopes, emit } = makeCollector();
    const ctx = makeCtx({ emitFeedback: emit, sessionId: 's-1' });
    await dispatchPlan({ steps: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] }, ctx);
    await dispatchMarkStepDone({ stepIndex: 0 }, ctx);
    await dispatchMarkStepDone({ stepIndex: 1 }, ctx);
    const ids = new Set(envelopes.map((e) => e.blockId));
    expect(ids.size).toBe(1);
    const seqs = envelopes.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });
});

describe('dispatchPlan · re-issuing replaces the active plan', () => {
  test('second Plan() within the same session gets a fresh ref + blockId', async () => {
    const { envelopes, emit } = makeCollector();
    const ctx = makeCtx({ emitFeedback: emit, sessionId: 's-1' });
    const r1 = await dispatchPlan({ steps: [{ text: 'old' }] }, ctx);
    const r2 = await dispatchPlan({ steps: [{ text: 'new A' }, { text: 'new B' }] }, ctx);
    expect(r2.ref).not.toBe(r1.ref);
    const startEnvelopes = envelopes.filter((e) => e.phase === 'start');
    expect(startEnvelopes).toHaveLength(2);
    expect(startEnvelopes[0]!.blockId).not.toBe(startEnvelopes[1]!.blockId);
    // MarkStepDone now operates on r2.
    const r3 = await dispatchMarkStepDone({ stepIndex: 0 }, ctx);
    expect(r3.ref).toBe(r2.ref);
    expect(r3.steps[0]!.text).toBe('new A');
  });
});

describe('dispatchPlan · safety', () => {
  test('empty steps array throws ToolSafetyError', async () => {
    await expect(
      dispatchPlan({ steps: [] }, makeCtx({ sessionId: 's-1' })),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('step with empty text throws ToolSafetyError', async () => {
    await expect(
      dispatchPlan(
        { steps: [{ text: 'good' }, { text: '' }] },
        makeCtx({ sessionId: 's-1' }),
      ),
    ).rejects.toThrow(ToolSafetyError);
  });

  // 2026-05-14 iOS dogfood — gemma-4-a4b on LM Studio emits the
  // simpler `steps: ["str", "str"]` shape instead of the schema's
  // `steps: [{text: "str"}, ...]`. dispatchPlan must accept both so
  // the user sees a plan UI instead of a "step[0] is missing a non-
  // empty `text` field" refusal that the model can't recover from.
  test('tolerant: string-array steps coerced into {text} form', async () => {
    const ctx = makeCtx({ sessionId: 's-string-tolerant' });
    const result = await dispatchPlan(
      { steps: ['First step', 'Second step', 'Third step'] as unknown as Array<{ text: string }> },
      ctx,
    );
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]!.text).toBe('First step');
    expect(result.steps[1]!.text).toBe('Second step');
    expect(result.steps[2]!.text).toBe('Third step');
  });

  test('tolerant: empty string in array still throws', async () => {
    await expect(
      dispatchPlan(
        { steps: ['good', '   '] as unknown as Array<{ text: string }> },
        makeCtx({ sessionId: 's-string-empty' }),
      ),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('tolerant: mixed string + object entries both work', async () => {
    const ctx = makeCtx({ sessionId: 's-mixed' });
    const result = await dispatchPlan(
      { steps: ['as string', { text: 'as object' }] as unknown as Array<{ text: string }> },
      ctx,
    );
    expect(result.steps.map((s) => s.text)).toEqual(['as string', 'as object']);
  });

  test('MarkStepDone without prior Plan throws', async () => {
    await expect(
      dispatchMarkStepDone({ stepIndex: 0 }, makeCtx({ sessionId: 's-1' })),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('MarkStepDone without sessionId throws (no plan can be looked up)', async () => {
    await expect(
      dispatchMarkStepDone({ stepIndex: 0 }, makeCtx()),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('MarkStepDone with out-of-range stepIndex throws', async () => {
    const ctx = makeCtx({ sessionId: 's-1' });
    await dispatchPlan({ steps: [{ text: 'A' }] }, ctx);
    await expect(
      dispatchMarkStepDone({ stepIndex: 5 }, ctx),
    ).rejects.toThrow(ToolSafetyError);
  });

  test('MarkStepDone with negative stepIndex throws', async () => {
    const ctx = makeCtx({ sessionId: 's-1' });
    await dispatchPlan({ steps: [{ text: 'A' }] }, ctx);
    await expect(
      dispatchMarkStepDone({ stepIndex: -1 }, ctx),
    ).rejects.toThrow(ToolSafetyError);
  });
});

describe('dispatchPlan · emitter resilience', () => {
  test('emitFeedback throwing does not crash Plan', async () => {
    const ctx = makeCtx({
      sessionId: 's-1',
      emitFeedback: () => {
        throw new Error('wire down');
      },
    });
    const r = await dispatchPlan({ steps: [{ text: 'A' }] }, ctx);
    expect(r.steps).toHaveLength(1);
  });

  test('emitFeedback throwing does not crash MarkStepDone', async () => {
    let calls = 0;
    const ctx = makeCtx({
      sessionId: 's-1',
      emitFeedback: () => {
        calls++;
        throw new Error('wire down');
      },
    });
    await dispatchPlan({ steps: [{ text: 'A' }] }, ctx);
    const r = await dispatchMarkStepDone({ stepIndex: 0 }, ctx);
    expect(r.steps[0]!.status).toBe('done');
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
