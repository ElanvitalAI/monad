// M1 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// SSE wire round-trip tests for the `feedback` event channel.
//
// Goal: lock the wire contract so daemon-side emit (lands M2/M5) can't
// drift the schema without flipping these tests red.
//
// Coverage:
//  1. parsePromptSseStream dispatches well-formed `feedback` events to
//     onFeedback with the envelope intact (no narrowing loss).
//  2. parsePromptSseStream silently drops schema-mismatch envelopes
//     (wrong version · unknown kind · bad phase · missing field) —
//     chat tab must stay alive through daemon-side regressions.
//  3. consumeObserverSse mirrors parsePromptSseStream for the multi-
//     tab observer path (Phase B-4 wire shape).
//  4. isFeedbackEnvelopeWire matches the daemon-side guard's behavior.

import { describe, expect, it } from 'bun:test';
import {
  consumeObserverSse,
  parsePromptSseStream,
  type PromptStreamHandlers,
} from './daemon-client';
import {
  isFeedbackEnvelopeWire,
  type FeedbackEnvelopeWire,
} from './feedback-envelope';

// ── helpers ──────────────────────────────────────────────────────────

function makeSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const validEnvelope: FeedbackEnvelopeWire = {
  envelopeVersion: 1,
  sessionId: 's-1',
  blockId: 's-1:agent:1',
  kind: 'agent.thinking',
  phase: 'update',
  emittedAt: 1_700_000_000_000,
  seq: 3,
  payload: { msg: 'reading file', metrics: { elapsedMs: 240 } },
  asciiFallback: ['⏳ reading file'],
};

// ── parsePromptSseStream — happy path ────────────────────────────────

describe('parsePromptSseStream · `feedback` event wire (M1 PR 2)', () => {
  it('dispatches a well-formed feedback envelope to onFeedback', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const handlers: PromptStreamHandlers = {
      onFeedback: (env) => collected.push(env),
    };
    const body = makeSseBody([
      sseLine('turn-begin', { sessionId: 's-1' }),
      sseLine('feedback', validEnvelope),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, handlers);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(validEnvelope);
  });

  it('preserves payload + asciiFallback through round-trip (no narrowing loss)', async () => {
    const diffEnvelope: FeedbackEnvelopeWire = {
      envelopeVersion: 1,
      sessionId: 's-2',
      blockId: 's-2:tool:tc-7',
      parentToolCallId: 'tc-7',
      kind: 'tool.diff',
      phase: 'end',
      emittedAt: 1_700_000_000_500,
      seq: 1,
      payload: {
        filePath: 'src/x.ts',
        language: 'typescript',
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { kind: 'del', text: 'foo' },
              { kind: 'add', text: 'bar' },
            ],
          },
        ],
      },
      asciiFallback: ['-foo', '+bar'],
    };
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', diffEnvelope),
      sseLine('turn-end', { sessionId: 's-2', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected[0]).toEqual(diffEnvelope);
    expect((collected[0]!.payload as { hunks: unknown[] }).hunks).toHaveLength(1);
    expect(collected[0]!.parentToolCallId).toBe('tc-7');
  });

  it('dispatches multiple feedback events in order', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', { ...validEnvelope, seq: 1 }),
      sseLine('feedback', { ...validEnvelope, seq: 2 }),
      sseLine('feedback', { ...validEnvelope, seq: 3 }),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('coexists with text-delta + tool-call events without cross-talk', async () => {
    const text: string[] = [];
    const tools: string[] = [];
    const fb: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('text-delta', { delta: 'He', full: 'He' }),
      sseLine('feedback', validEnvelope),
      sseLine('tool-call', { id: 'tc-1', name: 'read', args: {} }),
      sseLine('text-delta', { delta: 'llo', full: 'Hello' }),
      sseLine('turn-end', { sessionId: 's-1', text: 'Hello', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, {
      onTextDelta: ({ full }) => text.push(full),
      onToolCall: ({ id }) => tools.push(id),
      onFeedback: (env) => fb.push(env),
    });
    expect(text).toEqual(['He', 'Hello']);
    expect(tools).toEqual(['tc-1']);
    expect(fb).toEqual([validEnvelope]);
  });

  it('does not invoke onFeedback when handler is omitted', async () => {
    // Just verify the stream resolves cleanly without throwing.
    const body = makeSseBody([
      sseLine('feedback', validEnvelope),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    const result = await parsePromptSseStream(body, {});
    expect(result).toEqual({
      sessionId: 's-1',
      text: '',
      stopReason: 'end_turn',
    });
  });
});

// ── parsePromptSseStream — drop on schema mismatch ──────────────────

describe('parsePromptSseStream · drops malformed feedback envelopes', () => {
  it('drops envelope with wrong envelopeVersion', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', { ...validEnvelope, envelopeVersion: 2 }),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(0);
  });

  it('drops envelope with unknown kind', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', { ...validEnvelope, kind: 'mystery.kind' }),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(0);
  });

  it('drops envelope with bad phase', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', { ...validEnvelope, phase: 'midway' }),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(0);
  });

  it('drops envelope missing asciiFallback array', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const malformed = { ...validEnvelope } as Partial<FeedbackEnvelopeWire>;
    delete malformed.asciiFallback;
    const body = makeSseBody([
      sseLine('feedback', malformed),
      sseLine('turn-end', { sessionId: 's-1', text: '', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(0);
  });

  it('survives a malformed envelope mid-stream and continues to subsequent events', async () => {
    const fb: FeedbackEnvelopeWire[] = [];
    const text: string[] = [];
    const body = makeSseBody([
      sseLine('text-delta', { delta: 'A', full: 'A' }),
      sseLine('feedback', { ...validEnvelope, envelopeVersion: 99 }), // drop
      sseLine('feedback', { ...validEnvelope, seq: 5 }), // pass
      sseLine('text-delta', { delta: 'B', full: 'AB' }),
      sseLine('turn-end', { sessionId: 's-1', text: 'AB', stopReason: 'end_turn' }),
    ]);
    await parsePromptSseStream(body, {
      onTextDelta: ({ full }) => text.push(full),
      onFeedback: (env) => fb.push(env),
    });
    expect(text).toEqual(['A', 'AB']);
    expect(fb).toHaveLength(1);
    expect(fb[0]!.seq).toBe(5);
  });
});

// ── consumeObserverSse — observer path mirrors prompt path ──────────

describe('consumeObserverSse · `feedback` event wire (Phase B-4 + M1 PR 2)', () => {
  it('dispatches feedback envelopes through the observer wire', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      `event: subscribed\ndata: {}\n\n`,
      sseLine('turn-begin', { sessionId: 's-1' }),
      sseLine('feedback', validEnvelope),
      sseLine('feedback', { ...validEnvelope, seq: 2 }),
    ]);
    await consumeObserverSse(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.seq)).toEqual([3, 2]);
  });

  it('drops malformed feedback envelopes on observer path too', async () => {
    const collected: FeedbackEnvelopeWire[] = [];
    const body = makeSseBody([
      sseLine('feedback', { ...validEnvelope, kind: 'oops' }),
      sseLine('feedback', validEnvelope),
    ]);
    await consumeObserverSse(body, { onFeedback: (env) => collected.push(env) });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(validEnvelope);
  });
});

// ── isFeedbackEnvelopeWire — direct guard tests ─────────────────────

describe('isFeedbackEnvelopeWire · direct guard', () => {
  it('accepts a well-formed envelope', () => {
    expect(isFeedbackEnvelopeWire(validEnvelope)).toBe(true);
  });

  it('rejects null / non-object / array', () => {
    expect(isFeedbackEnvelopeWire(null)).toBe(false);
    expect(isFeedbackEnvelopeWire(undefined)).toBe(false);
    expect(isFeedbackEnvelopeWire('x')).toBe(false);
    expect(isFeedbackEnvelopeWire([])).toBe(false);
  });

  it('rejects each individually missing required field', () => {
    const fields: Array<keyof FeedbackEnvelopeWire> = [
      'envelopeVersion',
      'sessionId',
      'blockId',
      'kind',
      'phase',
      'emittedAt',
      'seq',
      'payload',
      'asciiFallback',
    ];
    for (const f of fields) {
      const broken = { ...validEnvelope } as Record<string, unknown>;
      delete broken[f];
      expect(isFeedbackEnvelopeWire(broken)).toBe(false);
    }
  });

  it('rejects negative seq', () => {
    expect(isFeedbackEnvelopeWire({ ...validEnvelope, seq: -1 })).toBe(false);
  });

  it('rejects non-string parentToolCallId when present', () => {
    expect(
      isFeedbackEnvelopeWire({ ...validEnvelope, parentToolCallId: 7 }),
    ).toBe(false);
  });

  it('accepts envelope without optional parentToolCallId', () => {
    const without = { ...validEnvelope };
    delete (without as Partial<FeedbackEnvelopeWire>).parentToolCallId;
    expect(isFeedbackEnvelopeWire(without)).toBe(true);
  });
});
