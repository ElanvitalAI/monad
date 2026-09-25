/**
 * NEXUS T3 endpoint contract test for IntakeApi.
 *
 * 사용자 dogfood 없이 NEXUS PR k 후 의 `/v1/intake[/...]` endpoint shape
 * 변동을 자동 차단. fetch mock 으로 200 정상 응답 매핑 + 503 not-wired
 * 에러 throw + 잘못된 query string 검증. DOGFOOD-nexus-t3 §S7 의 PWA-side
 * counterpart.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { DaemonClient } from './daemon-client';
import { IntakeApi } from './intake-api';

interface FetchCall {
  url: string | URL;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function mockResponse(opts: { status: number; body: unknown }): typeof fetch {
  return ((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input as string | URL, init });
    return {
      ok: opts.status >= 200 && opts.status < 300,
      status: opts.status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => opts.body,
      text: async () => JSON.stringify(opts.body),
    } as unknown as Response;
  }) as unknown) as typeof fetch;
}

function makeClient(): DaemonClient {
  return new DaemonClient({
    baseUrl: 'http://localhost:31415',
    token: '',
    provider: 'anthropic',
  });
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('IntakeApi.list — GET /v1/intake', () => {
  it('hits the bare endpoint when no filters provided', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { sessions: [] } });
    const api = new IntakeApi(makeClient());
    const result = await api.list();
    expect(calls.length).toBe(1);
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/intake');
    expect(result.sessions).toEqual([]);
  });

  it('serializes q / state / source filters into a query string', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { sessions: [] } });
    const api = new IntakeApi(makeClient());
    await api.list({ q: 'milk', state: 'captured', source: 'voice' });
    const url = String(calls[0]!.url);
    expect(url.startsWith('http://localhost:31415/v1/intake?')).toBe(true);
    expect(url).toContain('q=milk');
    expect(url).toContain('state=captured');
    expect(url).toContain('source=voice');
  });

  it('throws with the meta-api-runtime-not-wired hint when NEXUS returns 503', async () => {
    globalThis.fetch = mockResponse({
      status: 503,
      body: { error: 'meta-api-runtime-not-wired' },
    });
    const api = new IntakeApi(makeClient());
    await expect(api.list()).rejects.toThrow(/meta-api-runtime-not-wired/);
  });

  it('throws on unauthorized (401)', async () => {
    globalThis.fetch = mockResponse({
      status: 401,
      body: { error: 'unauthorized' },
    });
    const api = new IntakeApi(makeClient());
    await expect(api.list()).rejects.toThrow(/unauthorized/);
  });
});

describe('IntakeApi.detail / events / reviewView', () => {
  it('encodes the intakeId path segment', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { intakeId: 'api-2026-1', state: 'captured' } });
    const api = new IntakeApi(makeClient());
    await api.detail('api 2026/1');
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/intake/api%202026%2F1');
  });

  it('reviewView appends the suffix path', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { view: { config: {} } } });
    const api = new IntakeApi(makeClient());
    await api.reviewView('api-1');
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/intake/api-1/review-view');
  });

  it('events appends /events', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { events: [] } });
    const api = new IntakeApi(makeClient());
    await api.events('api-1');
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/intake/api-1/events');
  });
});

describe('IntakeApi.create — POST /v1/intake', () => {
  it('serializes the request body as JSON with content-type header', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { intakeId: 'api-2026-x' } });
    const api = new IntakeApi(makeClient());
    const result = await api.create({
      text: 'dogfood S7 — 우유 사기',
      mode: 'review',
    });
    expect(calls[0]!.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      text: 'dogfood S7 — 우유 사기',
      mode: 'review',
    });
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(result.intakeId).toBe('api-2026-x');
  });

  it('surfaces a 400 with the daemon error message', async () => {
    globalThis.fetch = mockResponse({
      status: 400,
      body: { error: 'text required' },
    });
    const api = new IntakeApi(makeClient());
    await expect(api.create({ text: '' })).rejects.toThrow(/text required/);
  });
});

describe('IntakeApi.mutate', () => {
  it('hits POST /v1/intake/:id/:action with the request body', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { intakeId: 'api-1' } });
    const api = new IntakeApi(makeClient());
    await api.mutate('api-1', 'apply', { confirm: true });
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/intake/api-1/apply');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ confirm: true });
  });

  it('defaults the body to an empty object when caller omits it', async () => {
    globalThis.fetch = mockResponse({ status: 200, body: { intakeId: 'api-1' } });
    const api = new IntakeApi(makeClient());
    await api.mutate('api-1', 'archive');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({});
  });
});
