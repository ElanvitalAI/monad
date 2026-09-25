// Rich-dev-feedback opportunistic followup §6.2 #3 (2026-05-13) —
// consumeAgentStatusSse contract.
//
// Verifies the PWA-side SSE consumer for `/v1/events?topics=agent.status`
// that the daemon-side bridge (wireAgentStatusEvents) emits onto.
//
// Invariants:
//  1. agent.status NexusEvent frames synthesize FeedbackEnvelopeWire
//     {kind:'agent.status', phase:'update', sessionId:opts.sessionId}.
//  2. Status enum translation: working→running, awaiting→queued,
//     done→done, err→error, idle→dropped.
//  3. blockId is stable per agentId: `${sessionId}:agent-status:${agentId}`
//     so the accumulator upserts the same `<StatusChip>` block across
//     transitions of the same agent.
//  4. seq is monotonic per blockId — independent across agents.
//  5. emittedAt mirrors detail.updatedAt when present, else ev.ts.
//  6. Malformed events (missing agentId / status, unknown status,
//     non-agent.status kinds) are silently dropped.
//  7. lastEvent propagates through to the envelope payload.

import { describe, expect, it } from 'bun:test';

import { consumeAgentStatusSse } from './daemon-client';
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

function nexusEvent(
  agentId: string,
  status: string,
  extras: { lastEvent?: string; updatedAt?: number; ts?: number } = {},
): { ts: number; kind: 'agent.status'; detail: Record<string, unknown> } {
  return {
    ts: extras.ts ?? extras.updatedAt ?? 1_700_000_000_000,
    kind: 'agent.status',
    detail: {
      agentId,
      status,
      updatedAt: extras.updatedAt ?? extras.ts ?? 1_700_000_000_000,
      ...(extras.lastEvent !== undefined ? { lastEvent: extras.lastEvent } : {}),
    },
  };
}

describe('consumeAgentStatusSse · happy path', () => {
  it('synthesizes one envelope per agent.status event with the expected shape', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([sseFrame('agent.status', nexusEvent('claude-1', 'working', { lastEvent: 'tool-call' }))]),
      's-chat-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toHaveLength(1);
    const env = got[0]!;
    expect(env.envelopeVersion).toBe(1);
    expect(env.kind).toBe('agent.status');
    expect(env.phase).toBe('update');
    expect(env.sessionId).toBe('s-chat-1');
    expect(env.blockId).toBe('s-chat-1:agent-status:claude-1');
    expect(env.payload).toEqual({
      agentId: 'claude-1',
      status: 'running',
      lastEvent: 'tool-call',
    });
    expect(isFeedbackEnvelopeWire(env)).toBe(true);
  });

  it('translates daemon SessionStatus → envelope status enum', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', nexusEvent('a', 'working')),
        sseFrame('agent.status', nexusEvent('a', 'awaiting')),
        sseFrame('agent.status', nexusEvent('a', 'done')),
        sseFrame('agent.status', nexusEvent('a', 'err')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got.map((e) => (e.payload as { status: string }).status)).toEqual([
      'running',
      'queued',
      'done',
      'error',
    ]);
  });

  it('drops idle status (no envelope equivalent)', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([sseFrame('agent.status', nexusEvent('a', 'idle'))]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toEqual([]);
  });

  it('blockId stable + seq monotonic across transitions of the same agent', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', nexusEvent('a', 'working')),
        sseFrame('agent.status', nexusEvent('a', 'done')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got[0]!.blockId).toBe(got[1]!.blockId);
    expect(got[0]!.seq).toBe(1);
    expect(got[1]!.seq).toBe(2);
  });

  it('seq monotonic is INDEPENDENT per agent', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', nexusEvent('a', 'working')),
        sseFrame('agent.status', nexusEvent('b', 'working')),
        sseFrame('agent.status', nexusEvent('a', 'done')),
        sseFrame('agent.status', nexusEvent('b', 'done')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got[0]!.seq).toBe(1); // a
    expect(got[1]!.seq).toBe(1); // b (independent)
    expect(got[2]!.seq).toBe(2); // a
    expect(got[3]!.seq).toBe(2); // b
  });

  it('emittedAt prefers detail.updatedAt over ev.ts', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', nexusEvent('a', 'working', { updatedAt: 5_000, ts: 9_999 })),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got[0]!.emittedAt).toBe(5_000);
  });
});

describe('consumeAgentStatusSse · drops on malformed input', () => {
  it('drops non-agent.status events (other NEXUS topics)', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('workflow.approval.pending', { ts: 1, kind: 'workflow.approval.pending', detail: {} }),
        sseFrame('agent.status', nexusEvent('a', 'working')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toHaveLength(1);
    expect((got[0]!.payload as { agentId: string }).agentId).toBe('a');
  });

  it('drops events with missing agentId', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([sseFrame('agent.status', { ts: 1, kind: 'agent.status', detail: { status: 'working' } })]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toEqual([]);
  });

  it('drops events with unknown status enum', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', nexusEvent('a', 'mystery')),
        sseFrame('agent.status', nexusEvent('a', 'working')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toHaveLength(1);
    expect((got[0]!.payload as { status: string }).status).toBe('running');
  });

  it('drops events missing detail entirely', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([sseFrame('agent.status', { ts: 1, kind: 'agent.status' })]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toEqual([]);
  });

  it('continues past malformed frames to valid ones (stream resilient)', async () => {
    const got: FeedbackEnvelopeWire[] = [];
    await consumeAgentStatusSse(
      makeSseBody([
        sseFrame('agent.status', { ts: 1, kind: 'agent.status' }), // no detail
        `event: agent.status\ndata: {not-json\n\n`, // malformed JSON
        sseFrame('agent.status', nexusEvent('a', 'working')),
      ]),
      's-1',
      { onFeedback: (env) => got.push(env) },
    );
    expect(got).toHaveLength(1);
  });
});
