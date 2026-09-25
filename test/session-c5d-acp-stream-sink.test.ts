// C5d (2026-07-16) — ACP 스트리밍 sink. broadcast 흡수(청크 → sessionUpdate 번역) + 인스턴스 가드.
// fake broadcast 주입 → 실 ACP 없이 유닛.

import { describe, test, expect } from 'bun:test';
import { createAcpStreamSink, type AcpBroadcast } from '../src/session/streaming/acp-stream-sink.js';
import { acpEndpointKey } from '../src/session/session-endpoint-key.js';

interface Bcast { sessionId: string; update: any }

function harness() {
  const calls: Bcast[] = [];
  const broadcast: AcpBroadcast = async (sessionId, update) => { calls.push({ sessionId, update }); return { delivered: 1 }; };
  return { broadcast, calls };
}

const EP = acpEndpointKey({ sessionId: 'sess-1' });

describe('createAcpStreamSink', () => {
  test('delta → agent_message_chunk(byte-identical push)', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    sink.onChunk(EP, { streamId: 's1', seq: 0, delta: 'Hello' }, { sessionId: 'sess-1' });
    expect(h.calls[0]).toEqual({
      sessionId: 'sess-1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } },
    });
  });

  test('reasoning → agent_thought_chunk', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    sink.onChunk(EP, { streamId: 's1', seq: 0, reasoning: '계획' }, { sessionId: 'sess-1' });
    expect(h.calls[0]!.update).toEqual({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '계획' } });
  });

  test('tool call → tool_call(pending) · result → tool_call_update(completed/failed)', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    sink.onChunk(EP, { streamId: 's1', seq: 0, tool: { id: 't1', name: 'Bash', phase: 'call' } }, { sessionId: 'sess-1' });
    expect(h.calls[0]!.update).toEqual({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Bash', status: 'pending' });
    sink.onChunk(EP, { streamId: 's1', seq: 1, tool: { id: 't1', name: 'Bash', phase: 'result', ok: true } }, { sessionId: 'sess-1' });
    expect(h.calls[1]!.update).toEqual({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    sink.onChunk(EP, { streamId: 's1', seq: 2, tool: { id: 't2', name: 'X', phase: 'result', ok: false } }, { sessionId: 'sess-1' });
    expect(h.calls[2]!.update).toMatchObject({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed' });
  });

  test('인스턴스 가드 — 다른 인스턴스 endpoint 는 broadcast 안 함', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    const foreign = acpEndpointKey({ sessionId: 'sess-1', instance: 'other-instance' });
    sink.onChunk(foreign, { streamId: 's1', seq: 0, delta: 'x' }, { sessionId: 'sess-1' });
    expect(h.calls).toEqual([]);
  });

  test('bare endpoint(비-키) 폴백 — ctx.sessionId 로 broadcast', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    sink.onChunk('not-a-key', { streamId: 's1', seq: 0, delta: 'y' }, { sessionId: 'ctx-sess' });
    expect(h.calls[0]!.sessionId).toBe('ctx-sess');
  });

  test('onFinal/onAbort — no-op(ACP 델타 누적 모델·throw 없음)', () => {
    const h = harness();
    const sink = createAcpStreamSink(h.broadcast);
    expect(() => { void sink.onFinal(EP, { streamId: 's1', role: 'assistant', text: 'final' }, { sessionId: 'sess-1' }); }).not.toThrow();
    expect(() => sink.onAbort!(EP, 's1', { sessionId: 'sess-1' })).not.toThrow();
    expect(h.calls).toEqual([]); // finalize 는 broadcast 안 함
  });
});
