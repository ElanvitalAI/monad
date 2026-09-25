// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M4 —
// consumeHudSegmentSse contract.
//
// Verifies the PWA-side SSE consumer for `/v1/events?topics=hud.segment`
// that the daemon-side bridge (wireHudSegmentEvents · M2) emits onto.
//
// Invariants:
//  1. hud.segment NexusEvent frames synthesize FeedbackEnvelopeWire
//     {kind:'hud.segment', phase:'update'|'end', sessionId:opts.sessionId}.
//  2. phase='end' frames carry payload {key} only (value placeholder
//     for wire-guard); phase='update' carries the full HudSegmentPayload.
//  3. blockId is stable per key: `${sessionId}:hud:${key}` so the M1
//     accumulator upserts the same segment across transitions.
//  4. seq is monotonic per blockId — independent across keys.
//  5. Malformed events (missing key, missing value on update, non-
//     hud.segment kinds) are silently dropped.
//  6. priority / tone / glyph propagate through to the envelope payload.

import { describe, expect, it } from 'bun:test';

import { consumeHudSegmentSse } from './daemon-client';
import {
  isFeedbackEnvelopeWire,
  type FeedbackEnvelopeWire,
} from './feedback-envelope';

function makeSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function hudSetEvent(
  key: string,
  value: string,
  extras: { priority?: number; tone?: string; glyph?: string; ts?: number } = {},
): { ts: number; kind: 'hud.segment'; detail: Record<string, unknown> } {
  return {
    ts: extras.ts ?? 1_700_000_000_000,
    kind: 'hud.segment',
    detail: {
      phase: 'update',
      key,
      value,
      ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
      ...(extras.tone !== undefined ? { tone: extras.tone } : {}),
      ...(extras.glyph !== undefined ? { glyph: extras.glyph } : {}),
    },
  };
}

function hudClearEvent(key: string, ts = 1_700_000_000_000): {
  ts: number;
  kind: 'hud.segment';
  detail: Record<string, unknown>;
} {
  return {
    ts,
    kind: 'hud.segment',
    detail: { phase: 'end', key },
  };
}

describe('consumeHudSegmentSse · happy path', () => {
  it('synthesizes update envelope from a single SSE frame', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('hud.segment', hudSetEvent('ctx', '87%', { priority: 5, tone: 'warn', glyph: '🍞' })),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toHaveLength(1);
    const env = received[0]!;
    expect(isFeedbackEnvelopeWire(env)).toBe(true);
    expect(env.kind).toBe('hud.segment');
    expect(env.phase).toBe('update');
    expect(env.sessionId).toBe('sess-1');
    expect(env.blockId).toBe('sess-1:hud:ctx');
    expect(env.payload).toMatchObject({
      key: 'ctx',
      value: '87%',
      priority: 5,
      tone: 'warn',
      glyph: '🍞',
    });
  });

  it('synthesizes end envelope from clear frame', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([sseFrame('hud.segment', hudClearEvent('voice-error'))]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toHaveLength(1);
    expect(received[0]!.phase).toBe('end');
    expect((received[0]!.payload as { key: string }).key).toBe('voice-error');
  });

  it('blockId stable per key across updates', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('hud.segment', hudSetEvent('ctx', '60%')),
        sseFrame('hud.segment', hudSetEvent('ctx', '87%')),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toHaveLength(2);
    expect(received[0]!.blockId).toBe(received[1]!.blockId);
    expect(received[0]!.seq).toBe(1);
    expect(received[1]!.seq).toBe(2);
  });

  it('seq independent across different keys', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('hud.segment', hudSetEvent('a', 'A')),
        sseFrame('hud.segment', hudSetEvent('b', 'B')),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received[0]!.seq).toBe(1);
    expect(received[1]!.seq).toBe(1); // independent counter per key
  });
});

describe('consumeHudSegmentSse · drop semantics', () => {
  it('drops update frames missing value', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('hud.segment', {
          ts: 1,
          kind: 'hud.segment',
          detail: { phase: 'update', key: 'a' }, // no value
        }),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toEqual([]);
  });

  it('drops frames missing key', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('hud.segment', {
          ts: 1,
          kind: 'hud.segment',
          detail: { phase: 'update', value: 'x' },
        }),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toEqual([]);
  });

  it('drops non-hud.segment events', async () => {
    const received: FeedbackEnvelopeWire[] = [];
    await consumeHudSegmentSse(
      makeSseBody([
        sseFrame('agent.status', { ts: 1, kind: 'agent.status', detail: { agentId: 'x', status: 'working' } }),
      ]),
      'sess-1',
      { onFeedback: (env) => received.push(env) },
    );
    expect(received).toEqual([]);
  });
});
