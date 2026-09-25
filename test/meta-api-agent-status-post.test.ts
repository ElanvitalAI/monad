// IPC followup (2026-05-13) — `POST /v1/agent-status` handler tests.
//
// Universal push seam: any process with a daemon bearer token can write
// to the daemon's canonical AgentStatusStore. The handler dedupes via
// the store's own change-check, then the wire bridge fans out as an
// `agent.status` NexusEvent on the `/v1/events` bus.
//
// Invariants under test:
//  1. 401 when bearer auth fails.
//  2. 503 when no agentStatusStore wired into MetaApiOpts.
//  3. 400 on bad JSON · empty agentId · invalid status enum.
//  4. 204 + store.set called with normalized payload on happy path.
//  5. lastEvent is optional · omitted when not a non-empty string.
//  6. Store dedupe still works at the wire boundary (re-POST same
//     state is idempotent).

import { describe, expect, test } from 'bun:test';

import { handleAgentStatusPost } from '../src/nexus/api/meta-api.js';
import { AgentStatusStore } from '../src/agent-status/store.js';

function makeReq(body: unknown, opts: { auth?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth) headers.authorization = opts.auth;
  return new Request('http://localhost/v1/agent-status', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleAgentStatusPost · auth + wire gates', () => {
  test('401 when bearer auth fails', async () => {
    const res = await handleAgentStatusPost(
      makeReq({ agentId: 'a', status: 'working' }),
      { bearerToken: 'secret', agentStatusStore: new AgentStatusStore() },
    );
    expect(res.status).toBe(401);
  });

  test('503 when no agentStatusStore is wired into opts', async () => {
    const res = await handleAgentStatusPost(
      makeReq({ agentId: 'a', status: 'working' }),
      { noAuth: true },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('agent-status-store-not-wired');
  });
});

describe('handleAgentStatusPost · validation', () => {
  test('400 on invalid JSON body', async () => {
    const res = await handleAgentStatusPost(
      makeReq('not-json{'),
      { noAuth: true, agentStatusStore: new AgentStatusStore() },
    );
    expect(res.status).toBe(400);
  });

  test('400 on empty / non-string agentId', async () => {
    const store = new AgentStatusStore();
    const res = await handleAgentStatusPost(
      makeReq({ agentId: '   ', status: 'working' }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(res.status).toBe(400);
    expect(store.entries()).toEqual([]);
  });

  test('400 on invalid status enum', async () => {
    const store = new AgentStatusStore();
    const res = await handleAgentStatusPost(
      makeReq({ agentId: 'a', status: 'running' /* envelope enum, not store enum */ }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; allowed: string[] };
    expect(body.error).toBe('invalid-status');
    expect(body.allowed).toContain('working');
    expect(store.entries()).toEqual([]);
  });
});

describe('handleAgentStatusPost · happy path', () => {
  test('204 + store updated on minimal valid body', async () => {
    const store = new AgentStatusStore();
    const res = await handleAgentStatusPost(
      makeReq({ agentId: 'claude-1', status: 'working' }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(res.status).toBe(204);
    const rec = store.getRecord('claude-1')!;
    expect(rec.status).toBe('working');
    expect(rec.lastEvent).toBeUndefined();
  });

  test('lastEvent propagates when present', async () => {
    const store = new AgentStatusStore();
    await handleAgentStatusPost(
      makeReq({ agentId: 'codex-1', status: 'err', lastEvent: 'turn-failed:timeout' }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(store.getRecord('codex-1')!.lastEvent).toBe('turn-failed:timeout');
  });

  test('lastEvent omitted when empty string', async () => {
    const store = new AgentStatusStore();
    await handleAgentStatusPost(
      makeReq({ agentId: 'codex-1', status: 'done', lastEvent: '' }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(store.getRecord('codex-1')!.lastEvent).toBeUndefined();
  });

  test('dedupe — second identical POST does not re-publish to store subscribers', async () => {
    const store = new AgentStatusStore();
    const transitions: string[] = [];
    store.subscribe((id, rec) => transitions.push(`${id}:${rec.status}:${rec.lastEvent ?? ''}`));
    await handleAgentStatusPost(
      makeReq({ agentId: 'a', status: 'working', lastEvent: 'turn-start' }),
      { noAuth: true, agentStatusStore: store },
    );
    await handleAgentStatusPost(
      makeReq({ agentId: 'a', status: 'working', lastEvent: 'turn-start' }),
      { noAuth: true, agentStatusStore: store },
    );
    expect(transitions).toEqual(['a:working:turn-start']);
  });

  test('multiple agents fan out independently', async () => {
    const store = new AgentStatusStore();
    const transitions: string[] = [];
    store.subscribe((id, rec) => transitions.push(`${id}:${rec.status}`));
    const opts = { noAuth: true as const, agentStatusStore: store };
    await handleAgentStatusPost(makeReq({ agentId: 'a', status: 'working' }), opts);
    await handleAgentStatusPost(makeReq({ agentId: 'b', status: 'working' }), opts);
    await handleAgentStatusPost(makeReq({ agentId: 'a', status: 'done' }), opts);
    expect(transitions).toEqual(['a:working', 'b:working', 'a:done']);
  });
});
