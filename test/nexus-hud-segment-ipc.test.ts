// PLAN-chat-hud-multi-surface-port-2026-05-13 §4 M2 — `POST
// /v1/hud-segment` handler + HudStore + wire bridge tests.
//
// Universal push seam: any process with a daemon bearer token can
// upsert/clear segments in the daemon's HudStore. The bridge fans
// transitions onto the `/v1/events` bus as `hud.segment` NexusEvents
// for PWA `<ChatHud>` (M4) to consume.
//
// Invariants under test:
//  1. HudStore set/clear/dedupe semantics (mirrors AgentStatusStore).
//  2. wireHudSegmentEvents publishes phase='update' on set,
//     phase='end' on clear, carries the full payload shape.
//  3. handleHudSegmentPost — 401 / 503 / 400 / 204 gates.
//  4. clear body shape: { key, clear: true } → store.delete.
//  5. tone/glyph/priority normalized through; invalid tone dropped.
//  6. Subscribers only fire for actual state changes (no-op POST
//     leaves the bus quiet).

import { describe, expect, test } from 'bun:test';

import { handleHudSegmentPost } from '../src/nexus/api/meta-api.js';
import { HudStore } from '../src/nexus/state/hud-store.js';
import {
  wireHudSegmentEvents,
  type HudSegmentEventDetail,
} from '../src/nexus/api/hud-event-bridge.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import type { NexusEvent } from '../src/nexus/state/state.js';

function makeReq(body: unknown, opts: { auth?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth) headers.authorization = opts.auth;
  return new Request('http://localhost/v1/hud-segment', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ── HudStore ─────────────────────────────────────────────────────────

describe('HudStore · upsert / clear / dedupe', () => {
  test('set stores the payload and emits to subscribers', () => {
    const store = new HudStore();
    const events: string[] = [];
    store.subscribe((ev) =>
      events.push(ev.kind === 'set' ? `set:${ev.key}:${ev.payload.value}` : `clear:${ev.key}`),
    );
    expect(store.set({ key: 'reasoning', value: 'diag', priority: 4 })).toBe(true);
    expect(store.get('reasoning')?.value).toBe('diag');
    expect(events).toEqual(['set:reasoning:diag']);
  });

  test('set returns false (and skips emit) for deep-equal payload', () => {
    const store = new HudStore();
    const events: string[] = [];
    store.subscribe((ev) => events.push(ev.kind));
    store.set({ key: 'a', value: 'A1', priority: 50 });
    expect(store.set({ key: 'a', value: 'A1', priority: 50 })).toBe(false);
    expect(events).toEqual(['set']);
  });

  test('clear removes + emits, idempotent', () => {
    const store = new HudStore();
    store.set({ key: 'x', value: 'X' });
    const events: string[] = [];
    store.subscribe((ev) => events.push(ev.kind));
    expect(store.clear('x')).toBe(true);
    expect(store.clear('x')).toBe(false);
    expect(store.get('x')).toBeUndefined();
    expect(events).toEqual(['clear']);
  });

  test('snapshot priority-sorts segments', () => {
    const store = new HudStore();
    store.set({ key: 'mid', value: 'M', priority: 50 });
    store.set({ key: 'hi', value: 'H', priority: 1 });
    store.set({ key: 'lo', value: 'L', priority: 90 });
    expect(store.snapshot().map((s) => s.key)).toEqual(['hi', 'mid', 'lo']);
  });
});

// ── wireHudSegmentEvents bridge ──────────────────────────────────────

describe('wireHudSegmentEvents · store → bus', () => {
  test('set publishes hud.segment / phase=update with full payload', () => {
    const bus = new NexusEventBus();
    const store = new HudStore();
    const received: HudSegmentEventDetail[] = [];
    const unsub = bus.subscribe((ev: NexusEvent) => {
      received.push(ev.detail as HudSegmentEventDetail);
    }, ['hud.segment']);
    wireHudSegmentEvents(bus, store);
    store.set({ key: 'ctx', value: '87%', tone: 'warn', priority: 5, glyph: '🍞' });
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      phase: 'update',
      key: 'ctx',
      value: '87%',
      tone: 'warn',
      priority: 5,
      glyph: '🍞',
    });
  });

  test('clear publishes phase=end · no payload fields', () => {
    const bus = new NexusEventBus();
    const store = new HudStore();
    store.set({ key: 'voice-error', value: 'lost mic' });
    const received: HudSegmentEventDetail[] = [];
    const unsub = bus.subscribe((ev: NexusEvent) => {
      received.push(ev.detail as HudSegmentEventDetail);
    }, ['hud.segment']);
    wireHudSegmentEvents(bus, store);
    store.clear('voice-error');
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ phase: 'end', key: 'voice-error' });
    expect(received[0]?.value).toBeUndefined();
  });

  test('teardown stops the bridge from publishing further events', () => {
    const bus = new NexusEventBus();
    const store = new HudStore();
    const received: unknown[] = [];
    bus.subscribe((ev: NexusEvent) => received.push(ev.detail), ['hud.segment']);
    const teardown = wireHudSegmentEvents(bus, store);
    store.set({ key: 'a', value: '1' });
    teardown();
    store.set({ key: 'b', value: '2' });
    expect(received).toHaveLength(1);
  });
});

// ── handleHudSegmentPost — auth + wire gates ─────────────────────────

describe('handleHudSegmentPost · auth + wire gates', () => {
  test('401 when bearer auth fails', async () => {
    const res = await handleHudSegmentPost(
      makeReq({ key: 'a', value: 'A' }),
      { bearerToken: 'secret', hudStore: new HudStore() },
    );
    expect(res.status).toBe(401);
  });

  test('503 when no hudStore is wired into opts', async () => {
    const res = await handleHudSegmentPost(
      makeReq({ key: 'a', value: 'A' }),
      { noAuth: true },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('hud-store-not-wired');
  });
});

describe('handleHudSegmentPost · validation', () => {
  test('400 on invalid JSON body', async () => {
    const res = await handleHudSegmentPost(
      makeReq('not-json{'),
      { noAuth: true, hudStore: new HudStore() },
    );
    expect(res.status).toBe(400);
  });

  test('400 on empty / missing key', async () => {
    const store = new HudStore();
    const res = await handleHudSegmentPost(
      makeReq({ key: '   ', value: 'x' }),
      { noAuth: true, hudStore: store },
    );
    expect(res.status).toBe(400);
    expect(store.entries()).toEqual([]);
  });

  test('400 on upsert with non-string value', async () => {
    const store = new HudStore();
    const res = await handleHudSegmentPost(
      makeReq({ key: 'a', value: 42 }),
      { noAuth: true, hudStore: store },
    );
    expect(res.status).toBe(400);
    expect(store.entries()).toEqual([]);
  });
});

describe('handleHudSegmentPost · happy path', () => {
  test('204 + store.set on minimal upsert body', async () => {
    const store = new HudStore();
    const res = await handleHudSegmentPost(
      makeReq({ key: 'ssh-remote', value: 'server-1' }),
      { noAuth: true, hudStore: store },
    );
    expect(res.status).toBe(204);
    expect(store.get('ssh-remote')?.value).toBe('server-1');
  });

  test('full payload (priority + tone + glyph) round-trips', async () => {
    const store = new HudStore();
    await handleHudSegmentPost(
      makeReq({
        key: 'ctx',
        value: '87%',
        priority: 5,
        tone: 'warn',
        glyph: '🍞',
      }),
      { noAuth: true, hudStore: store },
    );
    expect(store.get('ctx')).toEqual({
      key: 'ctx',
      value: '87%',
      priority: 5,
      tone: 'warn',
      glyph: '🍞',
    });
  });

  test('invalid tone is dropped but segment still upserts', async () => {
    const store = new HudStore();
    await handleHudSegmentPost(
      makeReq({ key: 'a', value: 'x', tone: 'fuchsia' }),
      { noAuth: true, hudStore: store },
    );
    expect(store.get('a')?.tone).toBeUndefined();
    expect(store.get('a')?.value).toBe('x');
  });

  test('clear body { key, clear: true } removes the segment', async () => {
    const store = new HudStore();
    store.set({ key: 'voice-error', value: 'lost mic' });
    const res = await handleHudSegmentPost(
      makeReq({ key: 'voice-error', clear: true }),
      { noAuth: true, hudStore: store },
    );
    expect(res.status).toBe(204);
    expect(store.get('voice-error')).toBeUndefined();
  });

  test('clear-of-absent is still 204 (idempotent)', async () => {
    const store = new HudStore();
    const res = await handleHudSegmentPost(
      makeReq({ key: 'never-set', clear: true }),
      { noAuth: true, hudStore: store },
    );
    expect(res.status).toBe(204);
  });

  test('dedupe — re-POST same payload does not re-emit on bus', async () => {
    const bus = new NexusEventBus();
    const store = new HudStore();
    wireHudSegmentEvents(bus, store);
    const received: unknown[] = [];
    bus.subscribe((ev: NexusEvent) => received.push(ev.detail), ['hud.segment']);
    const opts = { noAuth: true as const, hudStore: store };
    await handleHudSegmentPost(makeReq({ key: 'a', value: 'A' }), opts);
    await handleHudSegmentPost(makeReq({ key: 'a', value: 'A' }), opts);
    expect(received).toHaveLength(1);
  });
});
