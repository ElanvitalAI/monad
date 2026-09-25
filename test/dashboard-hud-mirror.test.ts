// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M3 — dashboard HUD
// mirror tests.
//
// Invariants under test:
//  1. subscribe(hud, cb) fires on setSegment / clearSegment.
//  2. activateHudMirrorIfReachable returns DEACTIVATED when discover
//     yields null (no daemon runtime.json wired).
//  3. Probe failure → active=false, no POST attempted on segment changes.
//  4. Happy path: setSegment → POST /v1/hud-segment with upsert body.
//  5. clearSegment → POST with { key, clear: true } body.
//  6. ANSI escape codes stripped from value before POST.
//  7. TUI-only segments (DEFAULT_DROPPED_SEGMENT_KEYS) skip POST.
//  8. deactivate() detaches the subscriber — subsequent set calls do
//     NOT trigger POST.
//  9. Custom droppedKeys override empties the filter list.

import { describe, expect, test } from 'bun:test';

import {
  activateHudMirrorIfReachable,
  DEFAULT_DROPPED_SEGMENT_KEYS,
} from '../src/dashboard/hud-mirror.js';
import {
  createHud,
  setSegment,
  clearSegment,
  subscribe,
} from '../src/panes/hud.js';

// ── panes/hud.ts subscribe contract ──────────────────────────────────

describe('panes/hud · subscribe(cb) fires on set/clear', () => {
  test('setSegment fires kind=set with payload', () => {
    const hud = createHud();
    const events: string[] = [];
    subscribe(hud, (ev) =>
      events.push(
        ev.kind === 'set' ? `set:${ev.key}:${ev.segment.value}:${ev.segment.priority}` : `clear:${ev.key}`,
      ),
    );
    setSegment(hud, 'ctx', '87%', 5);
    expect(events).toEqual(['set:ctx:87%:5']);
  });

  test('clearSegment fires kind=clear', () => {
    const hud = createHud();
    setSegment(hud, 'a', 'A');
    const events: string[] = [];
    subscribe(hud, (ev) => events.push(ev.kind));
    clearSegment(hud, 'a');
    expect(events).toEqual(['clear']);
  });

  test('clearSegment on absent key is a no-op (no event)', () => {
    const hud = createHud();
    const events: string[] = [];
    subscribe(hud, (ev) => events.push(ev.kind));
    clearSegment(hud, 'never');
    expect(events).toEqual([]);
  });

  test('unsubscribe stops further events', () => {
    const hud = createHud();
    const events: string[] = [];
    const unsubscribe = subscribe(hud, (ev) => events.push(ev.kind));
    setSegment(hud, 'a', 'A');
    unsubscribe();
    setSegment(hud, 'b', 'B');
    expect(events).toEqual(['set']);
  });
});

// ── Discovery / probe gates ──────────────────────────────────────────

describe('activateHudMirrorIfReachable · discovery gates', () => {
  test('DEACTIVATED when discover returns null', async () => {
    const hud = createHud();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => null,
    });
    expect(handle.active).toBe(false);
    expect(handle.baseUrl).toBeNull();
  });

  test('inactive when probe fails', async () => {
    const hud = createHud();
    const fetchImpl = (async () =>
      new Response(null, { status: 503 })) as unknown as typeof fetch;
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://example:1234' }),
      fetchImpl,
      log: () => {},
    });
    expect(handle.active).toBe(false);
    expect(handle.baseUrl).toBe('http://example:1234');
  });
});

// ── Happy path ───────────────────────────────────────────────────────

interface CapturedReq {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeCapturingFetch(): { fetchImpl: typeof fetch; calls: CapturedReq[] } {
  const calls: CapturedReq[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, headers, body });
    if (url.endsWith('/v1/health')) {
      return new Response(null, { status: 200 }) as unknown as Response;
    }
    return new Response(null, { status: 204 }) as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('activateHudMirrorIfReachable · happy path', () => {
  test('setSegment → POST /v1/hud-segment with upsert body', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://daemon:7777', token: 'tok' }),
      fetchImpl,
      log: () => {},
    });
    expect(handle.active).toBe(true);
    setSegment(hud, 'reasoning', 'diag', 4);
    // Allow microtask flush
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/hud-segment'));
    expect(post).toBeDefined();
    expect(post?.method).toBe('POST');
    expect(post?.headers.authorization).toBe('Bearer tok');
    expect(post?.body).toEqual({ key: 'reasoning', value: 'diag', priority: 4 });
    handle.deactivate();
  });

  test('clearSegment → POST with { key, clear: true }', async () => {
    const hud = createHud();
    setSegment(hud, 'voice-error', 'lost mic'); // before mirror; no POST
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
    });
    clearSegment(hud, 'voice-error');
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/hud-segment'));
    expect(post?.body).toEqual({ key: 'voice-error', clear: true });
    handle.deactivate();
  });

  test('ANSI codes stripped from value', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
      droppedKeys: new Set(), // disable default filter for this test
    });
    setSegment(hud, 'ctx', '\x1b[33mctx \x1b[0m\x1b[31m87%\x1b[0m');
    await Promise.resolve();
    await Promise.resolve();
    const post = calls.find((c) => c.url.endsWith('/v1/hud-segment'));
    expect((post?.body as { value: string }).value).toBe('ctx 87%');
    handle.deactivate();
  });
});

// ── Filter ───────────────────────────────────────────────────────────

describe('activateHudMirrorIfReachable · segment filter', () => {
  test('TUI-only segments do not POST', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
    });
    for (const key of DEFAULT_DROPPED_SEGMENT_KEYS) {
      setSegment(hud, key, 'x');
    }
    await Promise.resolve();
    await Promise.resolve();
    const posts = calls.filter((c) => c.url.endsWith('/v1/hud-segment'));
    expect(posts).toHaveLength(0);
    handle.deactivate();
  });

  test('non-filtered segment posts; filtered does not', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
    });
    setSegment(hud, 'chord', 'X');
    setSegment(hud, 'reasoning', 'diag');
    await Promise.resolve();
    await Promise.resolve();
    const posts = calls.filter((c) => c.url.endsWith('/v1/hud-segment'));
    expect(posts).toHaveLength(1);
    expect((posts[0]?.body as { key: string }).key).toBe('reasoning');
    handle.deactivate();
  });

  test('custom empty filter lets every key through', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
      droppedKeys: new Set(),
    });
    setSegment(hud, 'chord', 'X');
    setSegment(hud, 'reasoning', 'diag');
    await Promise.resolve();
    await Promise.resolve();
    const posts = calls.filter((c) => c.url.endsWith('/v1/hud-segment'));
    expect(posts).toHaveLength(2);
    handle.deactivate();
  });
});

// ── deactivate ───────────────────────────────────────────────────────

describe('activateHudMirrorIfReachable · deactivate detaches', () => {
  test('post-deactivate setSegment does not POST', async () => {
    const hud = createHud();
    const { fetchImpl, calls } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
    });
    handle.deactivate();
    setSegment(hud, 'reasoning', 'diag');
    await Promise.resolve();
    await Promise.resolve();
    const posts = calls.filter((c) => c.url.endsWith('/v1/hud-segment'));
    expect(posts).toHaveLength(0);
  });

  test('deactivate is idempotent', async () => {
    const hud = createHud();
    const { fetchImpl } = makeCapturingFetch();
    const handle = await activateHudMirrorIfReachable({
      hud,
      discover: () => ({ baseUrl: 'http://d:1' }),
      fetchImpl,
      log: () => {},
    });
    handle.deactivate();
    expect(() => handle.deactivate()).not.toThrow();
  });
});
