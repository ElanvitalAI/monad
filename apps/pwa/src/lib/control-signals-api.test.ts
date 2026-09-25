/**
 * NEXUS T3 endpoint contract test for ControlSignalsApi.
 *
 * DOGFOOD-nexus-t3 §S13 의 PWA-side counterpart. fetch mock 으로
 * `/v1/control-signals` 의 list (GET · query string) + emit (POST · body)
 * shape 검증.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ControlSignalsApi, type EmitSignalPayload } from './control-signals-api';
import { DaemonClient } from './daemon-client';

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

describe('ControlSignalsApi.list — GET /v1/control-signals', () => {
  it('hits the bare endpoint with no filters', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: { total: 0, latest: null, countsByKind: {}, items: [] },
    });
    const api = new ControlSignalsApi(makeClient());
    const result = await api.list();
    expect(String(calls[0]!.url)).toBe('http://localhost:31415/v1/control-signals');
    expect(result.total).toBe(0);
  });

  it('serializes filters into the query string', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: { total: 1, items: [] },
    });
    const api = new ControlSignalsApi(makeClient());
    await api.list({
      kind: 'turn-submit-begin',
      surface: 'pwa',
      minUrgency: 'normal',
      sessionId: 's-1',
      limit: '5',
    });
    const url = String(calls[0]!.url);
    expect(url).toContain('kind=turn-submit-begin');
    expect(url).toContain('surface=pwa');
    expect(url).toContain('minUrgency=normal');
    expect(url).toContain('sessionId=s-1');
    expect(url).toContain('limit=5');
  });

  it('drops empty-string filter values from the query string', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: { total: 0, items: [] },
    });
    const api = new ControlSignalsApi(makeClient());
    await api.list({ kind: '', surface: 'pwa' });
    const url = String(calls[0]!.url);
    expect(url).toContain('surface=pwa');
    expect(url).not.toContain('kind=');
  });

  it('returns the parsed response body verbatim', async () => {
    globalThis.fetch = mockResponse({
      status: 200,
      body: {
        total: 3,
        latest: '2026-05-06T12:00:00Z',
        countsByKind: { 'turn-submit-begin': 2, 'turn-submit-end': 1 },
        items: [
          { kind: 'turn-submit-begin', urgency: 'normal', createdAt: '2026-05-06T12:00:00Z' },
        ],
      },
    });
    const api = new ControlSignalsApi(makeClient());
    const result = await api.list({ limit: '5' });
    expect(result.total).toBe(3);
    expect(result.countsByKind?.['turn-submit-begin']).toBe(2);
    expect(result.items?.[0]?.kind).toBe('turn-submit-begin');
  });

  it('throws with the meta-api-runtime-not-wired hint on 503', async () => {
    globalThis.fetch = mockResponse({
      status: 503,
      body: { error: 'meta-api-runtime-not-wired' },
    });
    const api = new ControlSignalsApi(makeClient());
    await expect(api.list()).rejects.toThrow(/meta-api-runtime-not-wired/);
  });
});

describe('ControlSignalsApi.emit — POST /v1/control-signals', () => {
  it('serializes the request body as JSON', async () => {
    globalThis.fetch = mockResponse({ status: 201, body: { ok: true } });
    const api = new ControlSignalsApi(makeClient());
    const payload: EmitSignalPayload = {
      kind: 'turn-submit-begin',
      urgency: 'normal',
      source: 'pwa',
      mayPreempt: false,
      payload: { sessionId: 's-1' },
    };
    await api.emit(payload);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(payload);
  });

  it('throws on 503 (NEXUS PR k 이전 상태)', async () => {
    globalThis.fetch = mockResponse({
      status: 503,
      body: { error: 'meta-api-runtime-not-wired' },
    });
    const api = new ControlSignalsApi(makeClient());
    await expect(api.emit({ kind: 'noop', urgency: 'normal' })).rejects.toThrow(
      /meta-api-runtime-not-wired/,
    );
  });
});
