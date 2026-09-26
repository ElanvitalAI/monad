// Tier 1 Phase 3 양방향 sync · PR 2 · daemon-mirror activation tests.
//
// Tests inject discovery + fetchImpl so the daemon never actually
// boots — we only verify the mirror's wiring + payload shape +
// fail-silent contract. End-to-end (mirror → real daemon) coverage
// would duplicate PR 1's daemon-public-server-register-external suite.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { activateDaemonMirrorIfReachable } from '../src/session/daemon-mirror.js';
import {
  _clearSessionListenersForTest,
  appendMessage,
  createSession,
} from '../src/session/index.js';

let root: string;
let storeRoot: string;

beforeEach(() => {
  root = mkdtempSync(joinPath(tmpdir(), 'elanous-mirror-test-'));
  storeRoot = root;
  // session/index.ts uses sessionRoot() which honors XDG_DATA_HOME.
  process.env.XDG_DATA_HOME = root;
  _clearSessionListenersForTest();
});

afterEach(() => {
  delete process.env.XDG_DATA_HOME;
  _clearSessionListenersForTest();
  rmSync(root, { recursive: true, force: true });
  void storeRoot;
});

function ts(): string { return new Date().toISOString(); }

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

function buildFetchSpy(opts: {
  healthOk?: boolean;
  registerOk?: boolean;
} = {}): {
  fetchImpl: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]!;
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body, headers });
    if (url.endsWith('/v1/health')) {
      const ok = opts.healthOk ?? true;
      return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 });
    }
    if (url.endsWith('/v1/sessions/external')) {
      const ok = opts.registerOk ?? true;
      return new Response(
        JSON.stringify({ ok, sessionId: 'x', msgCount: 0 }),
        { status: ok ? 200 : 500 },
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('activateDaemonMirrorIfReachable', () => {
  test('returns inactive when discovery returns null (no daemon)', async () => {
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => null,
    });
    expect(handle.active).toBe(false);
    expect(handle.baseUrl).toBeNull();
  });

  test('returns inactive when probe fails', async () => {
    const { fetchImpl, calls } = buildFetchSpy({ healthOk: false });
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
      log: () => { /* swallow */ },
    });
    expect(handle.active).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/v1/health'))).toBeDefined();
  });

  test('on session create, posts register-external with empty messages', async () => {
    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
    });
    expect(handle.active).toBe(true);

    const meta = createSession({ provider: 'p', model: 'm' });
    // fire-and-forget — give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 10));

    const registerCalls = calls.filter((c) => c.url.endsWith('/v1/sessions/external'));
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]!.method).toBe('POST');
    expect(registerCalls[0]!.body).toEqual({ sessionId: meta.id, messages: [] });

    handle.deactivate();
  });

  test('on message append, posts only the latest message (incremental)', async () => {
    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
    });

    const meta = createSession({});
    appendMessage(meta.id, { role: 'user', content: 'hello', ts: ts() });
    appendMessage(meta.id, { role: 'assistant', content: 'world', ts: ts() });
    await new Promise((r) => setTimeout(r, 20));

    const registerCalls = calls.filter((c) => c.url.endsWith('/v1/sessions/external'));
    // 1 from createSession (empty), 2 from append.
    expect(registerCalls).toHaveLength(3);
    expect(registerCalls[1]!.body).toEqual({
      sessionId: meta.id,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(registerCalls[2]!.body).toEqual({
      sessionId: meta.id,
      messages: [{ role: 'assistant', content: 'world' }],
    });

    handle.deactivate();
  });

  test('append for a session NOT seen by mirror sends full local history', async () => {
    // Pre-create a session BEFORE activation so the mirror didn't see
    // its onSessionCreated event. Then append → mirror should detect
    // this is its first sync for that id and push the full history.
    const meta = createSession({});
    appendMessage(meta.id, { role: 'user', content: 'old', ts: ts() });
    appendMessage(meta.id, { role: 'assistant', content: 'older', ts: ts() });

    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
    });

    appendMessage(meta.id, { role: 'user', content: 'new', ts: ts() });
    await new Promise((r) => setTimeout(r, 20));

    const registerCalls = calls.filter((c) => c.url.endsWith('/v1/sessions/external'));
    // Only 1 call — for the new append, with full history (3 msgs).
    expect(registerCalls).toHaveLength(1);
    const body = registerCalls[0]!.body as { sessionId: string; messages: unknown[] };
    expect(body.sessionId).toBe(meta.id);
    expect(body.messages).toHaveLength(3);

    handle.deactivate();
  });

  test('skips tool-role messages (LLMMessage doesn\'t carry tool)', async () => {
    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
    });

    const meta = createSession({});
    appendMessage(meta.id, { role: 'tool', content: 'tool result', ts: ts() });
    await new Promise((r) => setTimeout(r, 20));

    const registerCalls = calls.filter((c) => c.url.endsWith('/v1/sessions/external'));
    // create fired (1 call), tool append filtered out (no extra).
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]!.body).toEqual({ sessionId: meta.id, messages: [] });

    handle.deactivate();
  });

  test('deactivate stops further mirroring', async () => {
    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
    });

    handle.deactivate();
    const meta = createSession({});
    appendMessage(meta.id, { role: 'user', content: 'x', ts: ts() });
    await new Promise((r) => setTimeout(r, 20));

    const registerCalls = calls.filter((c) => c.url.endsWith('/v1/sessions/external'));
    expect(registerCalls).toHaveLength(0);
  });

  test('register HTTP failure is silently swallowed', async () => {
    const { fetchImpl } = buildFetchSpy({ registerOk: false });
    const logs: string[] = [];
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9' }),
      fetchImpl,
      log: (m) => { logs.push(m); },
    });

    expect(handle.active).toBe(true);
    const meta = createSession({});
    appendMessage(meta.id, { role: 'user', content: 'fail', ts: ts() });
    await new Promise((r) => setTimeout(r, 20));

    // Logs should mention the failure but no exception escaped.
    expect(logs.some((m) => m.includes('mirror'))).toBe(true);

    handle.deactivate();
  });

  test('forwards bearer token in Authorization header when discover provides one', async () => {
    const { fetchImpl, calls } = buildFetchSpy();
    const handle = await activateDaemonMirrorIfReachable({
      discover: () => ({ baseUrl: 'http://stub:9', token: 'secret' }),
      fetchImpl,
    });

    const meta = createSession({});
    await new Promise((r) => setTimeout(r, 20));

    const registerCall = calls.find((c) => c.url.endsWith('/v1/sessions/external'));
    expect(registerCall?.headers['authorization']).toBe('Bearer secret');
    void meta;

    handle.deactivate();
  });
});
