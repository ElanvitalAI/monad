// R6.2 — handleReflection + parseReflectionPath.

import { describe, expect, test } from 'bun:test';

import {
  handleReflection,
  parseReflectionPath,
} from '../src/nexus/api/reflection.js';
import { createNotesMetricsCollector } from '../src/notes/metrics.js';

const NOW = Date.UTC(2026, 4, 9, 14, 0, 0);

function makeReq(path = '/v1/reflection/today'): Request {
  return new Request(`http://localhost${path}`);
}

describe('parseReflectionPath', () => {
  test("'/v1/reflection/today' → 'today'", () => {
    expect(parseReflectionPath('/v1/reflection/today')).toBe('today');
  });

  test("'/v1/reflection/2026-05-09' → '2026-05-09'", () => {
    expect(parseReflectionPath('/v1/reflection/2026-05-09')).toBe('2026-05-09');
  });

  test('invalid date format → null', () => {
    expect(parseReflectionPath('/v1/reflection/2026/05/09')).toBeNull();
    expect(parseReflectionPath('/v1/reflection/yesterday')).toBeNull();
    expect(parseReflectionPath('/v1/reflection/abc')).toBeNull();
  });

  test('non-matching path → null', () => {
    expect(parseReflectionPath('/v1/reflection')).toBeNull();
    expect(parseReflectionPath('/v1/reflection/today/extra')).toBeNull();
  });
});

describe('handleReflection · CORS + method', () => {
  test('OPTIONS → 204', () => {
    const req = new Request('http://localhost/v1/reflection/today', { method: 'OPTIONS' });
    const res = handleReflection(req, 'today', {});
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('POST → 405', () => {
    const req = new Request('http://localhost/v1/reflection/today', { method: 'POST' });
    const res = handleReflection(req, 'today', {});
    expect(res.status).toBe(405);
  });
});

describe('handleReflection · happy path', () => {
  test("'today' resolves via now()", async () => {
    const res = handleReflection(makeReq(), 'today', { now: () => NOW });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      snapshot: { date: string };
    };
    expect(body.ok).toBe(true);
    expect(body.snapshot.date).toBe('2026-05-09');
  });

  test('explicit date passes through', async () => {
    const res = handleReflection(makeReq('/v1/reflection/2026-05-08'), '2026-05-08', {
      now: () => NOW,
    });
    const body = await res.json() as { snapshot: { date: string; notesSaved: number } };
    expect(body.snapshot.date).toBe('2026-05-08');
    expect(body.snapshot.notesSaved).toBe(0);  // past date → 0 in v1
  });

  test('with metrics + history wired returns counts', async () => {
    const m = createNotesMetricsCollector();
    m.recordSave({ polishMode: 'minimal', ok: true });
    m.recordOcr({ provider: 'upstage', polishMode: 'minimal', ok: true });
    const res = handleReflection(makeReq(), 'today', {
      now: () => NOW,
      metrics: m,
      history: { summary: () => [
        { id: 's1', msgCount: 3, lastTurnAt: new Date(Date.UTC(2026, 4, 9, 10)).toISOString() },
      ] },
    });
    const body = await res.json() as {
      snapshot: {
        notesSaved: number;
        ocrRuns: number;
        sessionsToday: number;
        topSessions: Array<{ id: string }>;
      };
    };
    expect(body.snapshot.notesSaved).toBe(1);
    expect(body.snapshot.ocrRuns).toBe(1);
    expect(body.snapshot.sessionsToday).toBe(1);
    expect(body.snapshot.topSessions[0]!.id).toBe('s1');
  });
});

describe('handleReflection · auth seam', () => {
  test('checkAuth false → 401', async () => {
    const res = handleReflection(makeReq(), 'today', { checkAuth: () => false });
    expect(res.status).toBe(401);
  });
});
