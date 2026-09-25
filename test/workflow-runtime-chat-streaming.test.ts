// Surface-unification v2.1 (2026-05-11) — chat streaming SSE tests.
//
// Verifies that triggers with `streaming: true` produce an async
// iterable of SSE frames (start · progress · done) and the router
// returns the stream alongside a 200 status. Non-streaming triggers
// continue to use the synchronous body path.

import { describe, expect, it } from 'bun:test';
import { buildChatRouter, type ChatRegistryEntry, type ChatStreamFrame } from '../src/workflow-runtime/triggers/chat-router';

const regularEntry: ChatRegistryEntry = {
  workflowName: 'plain',
  nodeId: 'in',
  trigger: { path: '/plain' },
};
const streamingEntry: ChatRegistryEntry = {
  workflowName: 'stream',
  nodeId: 'in',
  trigger: { path: '/stream', streaming: true },
};

async function collect(stream: AsyncIterable<ChatStreamFrame>): Promise<ChatStreamFrame[]> {
  const out: ChatStreamFrame[] = [];
  for await (const f of stream) out.push(f);
  return out;
}

describe('buildChatRouter streaming', () => {
  it('returns synchronous body when streaming flag is absent', async () => {
    const dispatch = buildChatRouter({
      registry: [regularEntry],
      runWorkflow: async () => ({ ok: true as const, output: 'plain reply', runId: 'r' }),
      runStream: () => (async function* () { yield { event: 'progress', data: 'should-not-fire' }; })(),
    });
    const res = await dispatch({ path: '/plain', body: { message: 'hi' } });
    expect(res.status).toBe(200);
    expect(res.stream).toBeUndefined();
    expect(res.body).toMatchObject({ response: 'plain reply' });
  });

  it('returns a stream when trigger.streaming=true', async () => {
    const dispatch = buildChatRouter({
      registry: [streamingEntry],
      runWorkflow: async () => ({ ok: true as const, output: 'unused', runId: 'r' }),
      runStream: (_e, message) => (async function* () {
        yield { event: 'start', data: '{"runId":"r-1"}' };
        yield { event: 'progress', data: `{"msg":"${message}"}` };
        yield { event: 'done', data: '{"response":"final"}' };
      })(),
    });
    const res = await dispatch({ path: '/stream', body: { message: 'hello' } });
    expect(res.status).toBe(200);
    expect(res.stream).toBeDefined();
    const frames = await collect(res.stream!);
    expect(frames).toEqual([
      { event: 'start', data: '{"runId":"r-1"}' },
      { event: 'progress', data: '{"msg":"hello"}' },
      { event: 'done', data: '{"response":"final"}' },
    ]);
  });

  it('falls back to non-streaming when runStream is absent', async () => {
    const dispatch = buildChatRouter({
      registry: [streamingEntry],
      runWorkflow: async () => ({ ok: true as const, output: 'fallback reply', runId: 'r-fb' }),
    });
    const res = await dispatch({ path: '/stream', body: { message: 'hi' } });
    expect(res.status).toBe(200);
    expect(res.stream).toBeUndefined();
    expect(res.body).toMatchObject({ response: 'fallback reply' });
  });

  it('enforces auth before streaming', async () => {
    const authEntry: ChatRegistryEntry = {
      workflowName: 'auth-stream',
      nodeId: 'in',
      trigger: { path: '/auth-stream', streaming: true, auth: { type: 'bearer', token: 's' } },
    };
    const dispatch = buildChatRouter({
      registry: [authEntry],
      runWorkflow: async () => ({ ok: true as const, output: 'should-not-reach', runId: 'r' }),
      runStream: () => (async function* () { yield { event: 'done', data: '{}' }; })(),
    });
    const res = await dispatch({ path: '/auth-stream', body: { message: 'hi' } });
    expect(res.status).toBe(401);
    expect(res.stream).toBeUndefined();
  });
});
