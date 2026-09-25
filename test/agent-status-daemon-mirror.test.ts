// IPC followup (2026-05-13) — TUI → daemon agent-status mirror tests.
//
// Invariants under test:
//  1. discover returning null → DEACTIVATED (no probe, no subscribe).
//  2. probe failing → active=false, store subscribers not attached.
//  3. probe succeeding → store.set fires fetch POST with the expected
//     body shape on `/v1/agent-status`.
//  4. lastEvent propagates when present, omitted otherwise.
//  5. fetch failures during posting do not throw — best-effort mirror.
//  6. deactivate() detaches subscriber — no more POSTs.

import { describe, expect, test } from 'bun:test';

import { activateAgentStatusMirrorIfReachable } from '../src/agent-status/daemon-mirror.js';
import { AgentStatusStore } from '../src/agent-status/store.js';

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetchSpy(opts: {
  healthOk?: boolean;
  postOk?: boolean;
  postReject?: boolean;
} = {}): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headersInit = init?.headers ?? {};
    const headers: Record<string, string> = {};
    if (headersInit instanceof Headers) {
      headersInit.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(headersInit)) {
      for (const [k, v] of headersInit) headers[k.toLowerCase()] = v;
    } else {
      for (const [k, v] of Object.entries(headersInit)) headers[k.toLowerCase()] = String(v);
    }
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    if (url.endsWith('/v1/health')) {
      return new Response(null, { status: opts.healthOk === false ? 503 : 200 });
    }
    if (opts.postReject) throw new Error('network down');
    return new Response(null, { status: opts.postOk === false ? 400 : 204 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('activateAgentStatusMirrorIfReachable · discovery + probe gates', () => {
  test('returns DEACTIVATED when discover returns null', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy();
    const handle = await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => null,
    });
    expect(handle.active).toBe(false);
    expect(handle.baseUrl).toBe(null);
    store.set('a', 'working');
    expect(calls).toEqual([]);
  });

  test('returns inactive handle when /v1/health probe fails', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy({ healthOk: false });
    const handle = await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415' }),
      log: () => { /* silence */ },
    });
    expect(handle.active).toBe(false);
    expect(handle.baseUrl).toBe('http://localhost:31415');
    store.set('a', 'working');
    // Probe was the only fetch — subscriber never attached.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/v1/health');
  });
});

describe('activateAgentStatusMirrorIfReachable · happy path', () => {
  test('subscribes and POSTs to /v1/agent-status on every transition', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy();
    const handle = await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415', token: 'tok-1' }),
    });
    expect(handle.active).toBe(true);
    store.set('claude-1', 'working', 'tool-call:Read');
    // Drain microtasks so fire-and-forget completes.
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/agent-status'));
    expect(post).toBeDefined();
    expect(post!.method).toBe('POST');
    expect(post!.headers.authorization).toBe('Bearer tok-1');
    expect(post!.headers['content-type']).toBe('application/json');
    const parsed = JSON.parse(post!.body!) as Record<string, unknown>;
    expect(parsed).toEqual({
      agentId: 'claude-1',
      status: 'working',
      lastEvent: 'tool-call:Read',
    });
  });

  test('omits lastEvent in body when the record has none', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy();
    await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415' }),
    });
    store.set('codex-1', 'awaiting');
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/agent-status'))!;
    const parsed = JSON.parse(post.body!) as Record<string, unknown>;
    expect('lastEvent' in parsed).toBe(false);
    expect(parsed.status).toBe('awaiting');
  });

  test('omits authorization header when discover returned no token', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy();
    await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415' /* no token */ }),
    });
    store.set('a', 'working');
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/agent-status'))!;
    expect(post.headers.authorization).toBeUndefined();
  });
});

describe('activateAgentStatusMirrorIfReachable · resilience', () => {
  test('fetch throwing during POST does not crash subscriber', async () => {
    const store = new AgentStatusStore();
    const { fetchImpl } = makeFetchSpy({ postReject: true });
    const handle = await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415' }),
      log: () => { /* silence */ },
    });
    expect(handle.active).toBe(true);
    expect(() => store.set('a', 'working')).not.toThrow();
  });

  test('deactivate() unsubscribes — no further POSTs', async () => {
    const store = new AgentStatusStore();
    const { calls, fetchImpl } = makeFetchSpy();
    const handle = await activateAgentStatusMirrorIfReachable({
      store,
      fetchImpl,
      discover: () => ({ baseUrl: 'http://localhost:31415' }),
    });
    store.set('a', 'working');
    await Promise.resolve();
    await Promise.resolve();
    const before = calls.filter((c) => c.url.endsWith('/v1/agent-status')).length;
    handle.deactivate();
    expect(handle.active).toBe(false);
    store.set('a', 'done');
    await Promise.resolve();
    await Promise.resolve();
    const after = calls.filter((c) => c.url.endsWith('/v1/agent-status')).length;
    expect(after).toBe(before);
  });
});
