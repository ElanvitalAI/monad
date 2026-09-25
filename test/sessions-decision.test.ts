// R5.4 — handleSessionsDecision contract.
// + parseSessionDecisionPath unit tests.

import { describe, expect, test } from 'bun:test';

import {
  handleSessionsDecision,
  parseSessionDecisionPath,
  SESSION_DECISIONS,
} from '../src/nexus/api/sessions-decision.js';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/v1/sessions/sess-x/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('parseSessionDecisionPath', () => {
  test('happy path · returns sessionId', () => {
    expect(parseSessionDecisionPath('/v1/sessions/sess-1/decision')).toBe('sess-1');
  });

  test('url-encoded sessionId', () => {
    expect(parseSessionDecisionPath('/v1/sessions/sess%20one/decision')).toBe('sess one');
  });

  test('non-matching path → null', () => {
    expect(parseSessionDecisionPath('/v1/sessions/sess-1')).toBeNull();
    expect(parseSessionDecisionPath('/v1/sessions/active')).toBeNull();
    expect(parseSessionDecisionPath('/v1/notes/from-image')).toBeNull();
  });

  test('path traversal blocked', () => {
    // The :id segment is a single path segment so a literal `..`
    // is the only way to attempt traversal; we reject it.
    expect(parseSessionDecisionPath('/v1/sessions/../decision')).toBeNull();
  });
});

describe('handleSessionsDecision · CORS + method', () => {
  test('OPTIONS → 204 + CORS', async () => {
    const req = new Request('http://localhost/v1/sessions/x/decision', { method: 'OPTIONS' });
    const res = await handleSessionsDecision(req, 'x', {});
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('GET → 405', async () => {
    const req = new Request('http://localhost/v1/sessions/x/decision', { method: 'GET' });
    const res = await handleSessionsDecision(req, 'x', {});
    expect(res.status).toBe(405);
  });
});

describe('handleSessionsDecision · validation', () => {
  test('empty sessionId → 400', async () => {
    const res = await handleSessionsDecision(makeReq({ decision: 'approve' }), '', {});
    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const res = await handleSessionsDecision(makeReq('not-json'), 'x', {});
    expect(res.status).toBe(400);
  });

  test('unknown decision → 400', async () => {
    const res = await handleSessionsDecision(makeReq({ decision: 'maybe' }), 'x', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('reject');
  });

  test('missing decision field → 400', async () => {
    const res = await handleSessionsDecision(makeReq({}), 'x', {});
    expect(res.status).toBe(400);
  });
});

describe('handleSessionsDecision · happy path', () => {
  for (const dec of SESSION_DECISIONS) {
    test(`decision=${dec} → 200 + echo`, async () => {
      const res = await handleSessionsDecision(makeReq({ decision: dec }), 'sess-1', {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).toBe('sess-1');
      expect(body.decision).toBe(dec);
      expect(typeof body.ts).toBe('string');
    });
  }
});

describe('handleSessionsDecision · event bus fan-out', () => {
  test('publishes session-decision event when bus wired', async () => {
    const events: unknown[] = [];
    const eventBus = {
      publish: (e: unknown) => { events.push(e); },
    };
    await handleSessionsDecision(
      makeReq({ decision: 'approve' }),
      'sess-1',
      { eventBus, now: () => 1700000000000 },
    );
    expect(events).toHaveLength(1);
    const ev = events[0] as { ts: number; kind: string; detail: unknown };
    expect(ev.kind).toBe('session-decision');
    expect(ev.ts).toBe(1700000000000);
    expect(ev.detail).toEqual({ sessionId: 'sess-1', decision: 'approve' });
  });

  test('bus throw is swallowed (returns 200 anyway)', async () => {
    const eventBus = {
      publish: () => { throw new Error('bus down'); },
    };
    const res = await handleSessionsDecision(
      makeReq({ decision: 'reject' }),
      'sess-1',
      { eventBus },
    );
    expect(res.status).toBe(200);
  });

  test('bus omitted → 200 (silent skip)', async () => {
    const res = await handleSessionsDecision(
      makeReq({ decision: 'expand' }),
      'sess-1',
      {},
    );
    expect(res.status).toBe(200);
  });
});

describe('handleSessionsDecision · auth seam', () => {
  test('checkAuth false → 401', async () => {
    const res = await handleSessionsDecision(
      makeReq({ decision: 'approve' }),
      'sess-1',
      { checkAuth: () => false },
    );
    expect(res.status).toBe(401);
  });
});
