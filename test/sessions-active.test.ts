// R5.0 — handleSessionsActive contract.
//
// Coverage:
//   - OPTIONS preflight → 204 + CORS
//   - non-GET → 405
//   - history not wired → 503
//   - happy path · status pill derivation (active / idle / stale)
//   - stale filter (default omits, ?stale=1 includes)
//   - sort by recency (most-recent first)
//   - auth check seam → 401
//
// Cross-ref:
//   src/nexus/api/sessions-active.ts (SUT)
//   src/boot/daemon-runtime.ts (DaemonSessionSummary shape)

import { describe, expect, test } from 'bun:test';

import {
  handleSessionsActive,
  type SessionsActiveOpts,
} from '../src/nexus/api/sessions-active.js';
import type { DaemonSessionSummary } from '../src/boot/daemon-runtime.js';

const NOW = Date.UTC(2026, 4, 9, 12, 0, 0);
const minute = (n: number) => new Date(NOW - n * 60_000).toISOString();
const hour = (n: number) => new Date(NOW - n * 60 * 60_000).toISOString();

const stubHistory = (sessions: DaemonSessionSummary[]) =>
  ({
    summary: () => sessions,
  } as unknown as NonNullable<SessionsActiveOpts['history']>);

function makeReq(query = ''): Request {
  return new Request(`http://localhost/v1/sessions/active${query}`);
}

describe('handleSessionsActive · CORS + method', () => {
  test('OPTIONS → 204 with CORS', () => {
    const req = new Request('http://localhost/v1/sessions/active', { method: 'OPTIONS' });
    const res = handleSessionsActive(req, {});
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('POST → 405', () => {
    const req = new Request('http://localhost/v1/sessions/active', { method: 'POST' });
    const res = handleSessionsActive(req, {});
    expect(res.status).toBe(405);
  });
});

describe('handleSessionsActive · dep-injection', () => {
  test('history omitted → 503 sessions_history_not_wired', async () => {
    const res = handleSessionsActive(makeReq(), {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('sessions_history_not_wired');
  });
});

describe('handleSessionsActive · status pill derivation', () => {
  test('within 5min → active', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: minute(2) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions[0].status).toBe('active');
    expect(body.sessions[0].ageMs).toBe(2 * 60_000);
  });

  test('within 24h → idle', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: hour(3) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions[0].status).toBe('idle');
  });

  test('older than 24h → filtered out by default', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: hour(48) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test('?stale=1 includes stale sessions', async () => {
    const res = handleSessionsActive(makeReq('?stale=1'), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: hour(48) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].status).toBe('stale');
  });

  test('5min boundary → active (inclusive)', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: minute(5) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions[0].status).toBe('active');
  });

  test('5min+1ms → idle', async () => {
    const lastTurn = new Date(NOW - 5 * 60_000 - 1).toISOString();
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 3, lastTurnAt: lastTurn },
      ]),
    });
    const body = await res.json();
    expect(body.sessions[0].status).toBe('idle');
  });
});

describe('handleSessionsActive · sorting + preview pass-through', () => {
  test('most-recent first', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 'oldest', msgCount: 1, lastTurnAt: minute(4) },
        { id: 'newest', msgCount: 5, lastTurnAt: minute(1) },
        { id: 'middle', msgCount: 3, lastTurnAt: minute(3) },
      ]),
    });
    const body = await res.json();
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  test('lastMsgPreview + origin pass through', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        {
          id: 's1',
          msgCount: 3,
          lastTurnAt: minute(2),
          lastMsgPreview: 'hello',
          origin: 'pwa',
        },
      ]),
    });
    const body = await res.json();
    expect(body.sessions[0].lastMsgPreview).toBe('hello');
    expect(body.sessions[0].origin).toBe('pwa');
  });

  test('invalid lastTurnAt → treated as max-old (filtered out by default)', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([
        { id: 's1', msgCount: 1, lastTurnAt: 'not-a-date' },
      ]),
    });
    const body = await res.json();
    expect(body.sessions).toHaveLength(0);
  });
});

describe('handleSessionsActive · auth seam', () => {
  test('checkAuth false → 401', async () => {
    const res = handleSessionsActive(makeReq(), {
      history: stubHistory([]),
      checkAuth: () => false,
    });
    expect(res.status).toBe(401);
  });
});

describe('handleSessionsActive · ts in body', () => {
  test('ts reflects now() seam', async () => {
    const res = handleSessionsActive(makeReq(), {
      now: () => NOW,
      history: stubHistory([]),
    });
    const body = await res.json();
    expect(body.ts).toBe(new Date(NOW).toISOString());
  });
});
