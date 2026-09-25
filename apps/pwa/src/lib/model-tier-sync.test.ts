// M1-2b (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// PWA ↔ daemon round-trip helpers. Stubs `fetch` so the tests stay
// network-isolated and exercise both happy + offline branches.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  fetchDaemonModelTier,
  hydrateFromDaemon,
  pushMonthlyCapToDaemon,
  pushSttTierToDaemon,
  type DaemonHttpConfig,
} from './model-tier-sync';

const CFG: DaemonHttpConfig = { baseUrl: 'http://localhost:31415', token: 'tk' };

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[] = [];

function installFetch(
  responder: (call: FetchCall) => { status?: number; body?: unknown } | Error,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = init?.body; }
    const call = { url, method, headers, body };
    calls.push(call);
    const r = responder(call);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function installLocalStorage(): void {
  const store = new Map<string, string>();
  const ls = {
    getItem(k: string) { return store.has(k) ? store.get(k)! : null; },
    setItem(k: string, v: string) { store.set(k, v); },
    removeItem(k: string) { store.delete(k); },
    clear() { store.clear(); },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    get length() { return store.size; },
  };
  (globalThis as unknown as { window: object }).window = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = ls as Storage;
}

beforeEach(() => {
  calls = [];
  installLocalStorage();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as unknown as { window?: object }).window;
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

describe('M1-2b · fetchDaemonModelTier', () => {
  test('parses voice.stt + monthlyUsdCap', async () => {
    installFetch(() => ({
      body: {
        modelTier: { voice: { stt: 'best' } },
        budget: { monthlyUsdCap: 25 },
      },
    }));
    const r = await fetchDaemonModelTier(CFG);
    expect(r).toEqual({ stt: 'best', monthlyUsdCap: 25 });
    expect(calls[0]?.url).toBe('http://localhost:31415/v1/config/model-tier');
    expect(calls[0]?.headers.authorization).toBe('Bearer tk');
  });

  test('empty daemon response → empty state object', async () => {
    installFetch(() => ({ body: {} }));
    expect(await fetchDaemonModelTier(CFG)).toEqual({});
  });

  test('non-OK → null', async () => {
    installFetch(() => ({ status: 500, body: { error: 'boom' } }));
    expect(await fetchDaemonModelTier(CFG)).toBeNull();
  });

  test('fetch throws (offline) → null', async () => {
    installFetch(() => new TypeError('Failed to fetch'));
    expect(await fetchDaemonModelTier(CFG)).toBeNull();
  });

  test('empty baseUrl → null without calling fetch', async () => {
    installFetch(() => ({ body: {} }));
    expect(await fetchDaemonModelTier({ baseUrl: '' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('invalid tier value dropped on read', async () => {
    installFetch(() => ({ body: { modelTier: { voice: { stt: 'ultra' } } } }));
    expect(await fetchDaemonModelTier(CFG)).toEqual({});
  });
});

describe('M1-2b · hydrateFromDaemon', () => {
  test('merges daemon stt + local audioMinPerDay', async () => {
    localStorage.setItem(
      'monad.model-tier.prefs',
      JSON.stringify({ stt: 'balanced', audioMinPerDay: 10 }),
    );
    installFetch(() => ({ body: { modelTier: { voice: { stt: 'best' } } } }));
    const merged = await hydrateFromDaemon(CFG);
    expect(merged?.stt).toBe('best');
    expect(merged?.audioMinPerDay).toBe(10);
  });

  test('daemon empty · local tier preserved', async () => {
    localStorage.setItem(
      'monad.model-tier.prefs',
      JSON.stringify({ stt: 'better', audioMinPerDay: 3 }),
    );
    installFetch(() => ({ body: {} }));
    const merged = await hydrateFromDaemon(CFG);
    expect(merged?.stt).toBe('better');
    expect(merged?.audioMinPerDay).toBe(3);
  });

  test('daemon unreachable → null (caller falls back to local read)', async () => {
    installFetch(() => new TypeError('Failed to fetch'));
    expect(await hydrateFromDaemon(CFG)).toBeNull();
  });
});

describe('M1-2b · pushSttTierToDaemon', () => {
  test('happy path · writes localStorage + PUT body · returns synced', async () => {
    installFetch(() => ({ body: { modelTier: { voice: { stt: 'best' } } } }));
    const status = await pushSttTierToDaemon(CFG, 'best');
    expect(status).toBe('synced');
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.body).toEqual({ modelTier: { voice: { stt: 'best' } } });
    // localStorage written first (optimistic).
    expect(JSON.parse(localStorage.getItem('monad.model-tier.prefs')!).stt).toBe('best');
  });

  test('null tier clears modelTier · localStorage cleared too', async () => {
    localStorage.setItem(
      'monad.model-tier.prefs',
      JSON.stringify({ stt: 'best', audioMinPerDay: 0 }),
    );
    installFetch(() => ({ body: {} }));
    const status = await pushSttTierToDaemon(CFG, null);
    expect(status).toBe('synced');
    expect(calls[0]?.body).toEqual({ modelTier: null });
    // resetModelTierPrefs clears the localStorage entry entirely.
    expect(localStorage.getItem('monad.model-tier.prefs')).toBeNull();
  });

  test('offline → "offline" status · localStorage still has user intent', async () => {
    installFetch(() => new TypeError('Failed to fetch'));
    const status = await pushSttTierToDaemon(CFG, 'loaded');
    expect(status).toBe('offline');
    // Optimistic local write still landed.
    expect(JSON.parse(localStorage.getItem('monad.model-tier.prefs')!).stt).toBe('loaded');
  });

  test('5xx → "error" status', async () => {
    installFetch(() => ({ status: 500 }));
    expect(await pushSttTierToDaemon(CFG, 'best')).toBe('error');
  });

  test('empty baseUrl → offline (never makes a request)', async () => {
    installFetch(() => ({ body: {} }));
    expect(await pushSttTierToDaemon({ baseUrl: '' }, 'best')).toBe('offline');
    expect(calls).toHaveLength(0);
  });
});

describe('M1-2b · pushMonthlyCapToDaemon', () => {
  test('positive cap → PUT body shape', async () => {
    installFetch(() => ({ body: {} }));
    expect(await pushMonthlyCapToDaemon(CFG, 25)).toBe('synced');
    expect(calls[0]?.body).toEqual({ budget: { monthlyUsdCap: 25 } });
  });

  test('null cap clears budget', async () => {
    installFetch(() => ({ body: {} }));
    expect(await pushMonthlyCapToDaemon(CFG, null)).toBe('synced');
    expect(calls[0]?.body).toEqual({ budget: null });
  });
});
