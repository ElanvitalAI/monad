// W9c Z13-c · morning-showroom-api wire.

import { describe, expect, test } from 'bun:test';
import {
  createMorningShowroomApi,
  MorningShowroomApiError,
  type MorningDigestRequest,
} from './morning-showroom-api';

function mockFetch(handler: (init?: RequestInit) => { status: number; body?: unknown }) {
  let lastInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    lastInit = init;
    const r = handler(init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, getInit: () => lastInit };
}

const req: MorningDigestRequest = {
  date: '2026-05-12',
  windowStart: '2026-05-11T22:00:00Z',
  windowEnd: '2026-05-12T08:00:00Z',
  runs: [{ taskId: 't', taskTitle: 'x', outcome: 'completed', startedAt: 0, endedAt: 100 }],
};

describe('createMorningShowroomApi.compose', () => {
  test('200 returns the card', async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      body: { card: { kind: 'morning-digest-showroom', date: '2026-05-12', lanes: [], createdAt: 0 } },
    }));
    const api = createMorningShowroomApi({ baseUrl: 'http://x', fetchImpl });
    const card = await api.compose(req);
    expect(card.kind).toBe('morning-digest-showroom');
    expect(card.date).toBe('2026-05-12');
  });

  test('400 surfaces MorningShowroomApiError', async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 400, body: { error: 'invalid-digest-input' } }));
    const api = createMorningShowroomApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.compose(req); expect.unreachable(); }
    catch (err) {
      expect(err).toBeInstanceOf(MorningShowroomApiError);
      expect((err as MorningShowroomApiError).status).toBe(400);
    }
  });

  test('200 without card envelope is treated as error', async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 200, body: {} }));
    const api = createMorningShowroomApi({ baseUrl: 'http://x', fetchImpl });
    try { await api.compose(req); expect.unreachable(); }
    catch (err) {
      expect(err).toBeInstanceOf(MorningShowroomApiError);
    }
  });

  test('authHeader forwarded on the POST', async () => {
    const { fetchImpl, getInit } = mockFetch(() => ({
      status: 200,
      body: { card: { kind: 'morning-digest-showroom', date: 'd', lanes: [], createdAt: 0 } },
    }));
    const api = createMorningShowroomApi({ baseUrl: 'http://x', fetchImpl, authHeader: 'Bearer t' });
    await api.compose(req);
    const headers = (getInit()?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer t');
  });
});
