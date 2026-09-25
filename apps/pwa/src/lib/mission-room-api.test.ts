// W9c Z13-b · mission-room-api · typed fetch wire.

import { describe, expect, test } from 'bun:test';
import {
  createMissionRoomApi,
  MissionRoomApiError,
  type MissionRoomDecisionWire,
  type MissionRoomStateWire,
} from './mission-room-api';

interface Capture {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

function makeMockFetch(handlers: Record<string, () => { status: number; body?: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Capture[];
} {
  const calls: Capture[] = [];
  const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    const decodedPath = decodeURIComponent(u.pathname);
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const handler = handlers[`${init?.method ?? 'GET'} ${decodedPath}`] ?? handlers[decodedPath] ?? handlers['*'];
    if (!handler) throw new Error(`no mock handler for ${url}`);
    const r = handler();
    return new Response(JSON.stringify(r.body ?? null), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const BASE = 'http://x';

function buildState(extra?: Partial<MissionRoomStateWire>): MissionRoomStateWire {
  return {
    missionId: 'mission:abc',
    showroomSessionId: 'showroom:abc',
    missionTag: 'frontend',
    status: 'active',
    spawnedAt: 1000,
    decisions: [],
    ...extra,
  };
}

function buildDecision(extra?: Partial<MissionRoomDecisionWire>): MissionRoomDecisionWire {
  return {
    ts: 2000,
    question: 'option A vs B?',
    opinions: [{ role: 'architect-claude', text: 'pick B' }],
    resolution: { status: 'open' },
    ...extra,
  };
}

describe('createMissionRoomApi · base + auth', () => {
  test('strips trailing slash from baseUrl + builds /v1 path', async () => {
    const mock = makeMockFetch({
      'GET /v1/missions/mission:abc/showroom': () => ({ status: 200, body: { state: buildState(), missionShowroomUrl: '/showroom?show=showroom%3Aabc' } }),
    });
    const api = createMissionRoomApi({ baseUrl: 'http://x/', fetchImpl: mock.fetchImpl });
    await api.spawn('mission:abc');
    // encodeURIComponent maps ':' → '%3A' so the wire URL is safe.
    expect(mock.calls[0]!.url).toBe('http://x/v1/missions/mission%3Aabc/showroom');
  });

  test('authHeader is forwarded on every call', async () => {
    const mock = makeMockFetch({
      'GET /v1/missions/mission:abc/showroom': () => ({ status: 200, body: { state: buildState(), missionShowroomUrl: '/u' } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl, authHeader: 'Bearer t' });
    await api.spawn('mission:abc');
    expect(mock.calls[0]!.headers.authorization).toBe('Bearer t');
  });

  test('non-2xx responses raise MissionRoomApiError with status + path', async () => {
    const mock = makeMockFetch({
      'GET /v1/missions/missing/showroom': () => ({ status: 404, body: { error: 'mission-not-found' } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    try {
      await api.spawn('missing');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MissionRoomApiError);
      const e = err as MissionRoomApiError;
      expect(e.status).toBe(404);
      expect(e.path).toBe('/v1/missions/missing/showroom');
    }
  });
});

describe('createMissionRoomApi · spawn', () => {
  test('returns state + missionShowroomUrl from GET /showroom', async () => {
    const mock = makeMockFetch({
      'GET /v1/missions/mission:abc/showroom': () => ({ status: 200, body: { state: buildState(), missionShowroomUrl: '/showroom?show=showroom%3Aabc' } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    const out = await api.spawn('mission:abc');
    expect(out.state.missionId).toBe('mission:abc');
    expect(out.missionShowroomUrl).toContain('show=showroom');
  });
});

describe('createMissionRoomApi · deliberate', () => {
  test('POSTs question + missionContext, returns decision', async () => {
    const mock = makeMockFetch({
      'POST /v1/missions/mission:abc/showroom/deliberate': () => ({ status: 200, body: { decision: buildDecision() } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    const decision = await api.deliberate('mission:abc', 'option A vs B?', 'context lines');
    expect(decision.resolution.status).toBe('open');
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.question).toBe('option A vs B?');
    expect(body.missionContext).toBe('context lines');
  });

  test('omits missionContext from body when undefined', async () => {
    const mock = makeMockFetch({
      'POST /v1/missions/mission:abc/showroom/deliberate': () => ({ status: 200, body: { decision: buildDecision() } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    await api.deliberate('mission:abc', 'q');
    const body = JSON.parse(mock.calls[0]!.body!);
    expect(body.missionContext).toBeUndefined();
    expect(body.question).toBe('q');
  });
});

describe('createMissionRoomApi · decide + archive', () => {
  test('decide POSTs chosen + returns updated decision', async () => {
    const mock = makeMockFetch({
      'POST /v1/missions/mission:abc/showroom/decision': () => ({
        status: 200,
        body: { decision: buildDecision({ resolution: { status: 'decided', chosen: 'option-B' } }) },
      }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    const decision = await api.decide('mission:abc', 'option-B');
    expect(decision.resolution).toEqual({ status: 'decided', chosen: 'option-B' });
  });

  test('archive returns the archived state', async () => {
    const mock = makeMockFetch({
      'POST /v1/missions/mission:abc/showroom/archive': () => ({
        status: 200,
        body: { state: buildState({ status: 'archived', archivedAt: 9000 }) },
      }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    const state = await api.archive('mission:abc');
    expect(state.status).toBe('archived');
    expect(state.archivedAt).toBe(9000);
  });
});

describe('createMissionRoomApi · 409 archived rejection', () => {
  test('deliberate against an archived room surfaces 409', async () => {
    const mock = makeMockFetch({
      'POST /v1/missions/mission:abc/showroom/deliberate': () => ({ status: 409, body: { error: 'deliberate-failed' } }),
    });
    const api = createMissionRoomApi({ baseUrl: BASE, fetchImpl: mock.fetchImpl });
    try {
      await api.deliberate('mission:abc', 'q');
      expect.unreachable();
    } catch (err) {
      const e = err as MissionRoomApiError;
      expect(e.status).toBe(409);
    }
  });
});
