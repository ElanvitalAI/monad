// Service Worker Phase 4 — caching strategy verification.
//
// The cache logic lives inside `apps/pwa/public/sw.js` (raw service
// worker, not import-able as a module). Rather than refactor it for
// testability — which would force a build step — we lift the two
// strategy helpers as pure functions here and pin their behaviour.
// The sw.js implementations mirror these contracts byte-for-byte;
// the README inside sw.js documents the expectation. Any drift
// surfaces as a SW dogfood regression which we'd catch on first
// /term reload offline.
//
// Why this matters: cache-first vs network-first chooses correctness
// trade-offs that dogfood-only verification can hide. A unit pin
// here keeps the strategy explicit + reviewable.

import { describe, expect, test } from 'bun:test';

interface StubResponse {
  ok: boolean;
  status: number;
  clone: () => StubResponse;
  body?: string;
}
interface StubCache {
  match: (req: string) => Promise<StubResponse | undefined>;
  put: (req: string, res: StubResponse) => Promise<void>;
}

function makeStubCache(seed: Record<string, StubResponse> = {}): StubCache {
  const store = new Map<string, StubResponse>(Object.entries(seed));
  return {
    match: async (req: string) => store.get(req),
    put: async (req: string, res: StubResponse) => {
      store.set(req, res);
    },
  };
}

function makeResponse(body: string, opts: { ok?: boolean; status?: number } = {}): StubResponse {
  const r: StubResponse = {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body,
    clone: () => r,
  };
  return r;
}

// Inline copies of the strategy helpers from sw.js. Match the
// implementations exactly — any drift means sw.js + this test fall
// out of sync and dogfood breaks.

async function cacheFirst(
  request: string,
  cache: StubCache,
  doFetch: (req: string) => Promise<StubResponse>,
): Promise<StubResponse> {
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await doFetch(request);
    if (fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    return makeResponse('', { ok: false, status: 504 });
  }
}

async function networkFirstWithOfflineFallback(
  request: string,
  runtimeCache: StubCache,
  precache: StubCache,
  doFetch: (req: string) => Promise<StubResponse>,
): Promise<StubResponse> {
  try {
    const fresh = await doFetch(request);
    if (fresh.ok) {
      runtimeCache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    const cached = await runtimeCache.match(request);
    if (cached) return cached;
    const offline = await precache.match('/app/offline.html');
    if (offline) return offline;
    return makeResponse('', { ok: false, status: 503 });
  }
}

describe('cacheFirst', () => {
  test('returns cached entry without calling fetch', async () => {
    const cache = makeStubCache({ '/app/_next/static/x.js': makeResponse('cached') });
    let fetchCalls = 0;
    const r = await cacheFirst('/app/_next/static/x.js', cache, async () => {
      fetchCalls += 1;
      return makeResponse('fresh');
    });
    expect(r.body).toBe('cached');
    expect(fetchCalls).toBe(0);
  });

  test('falls through to network on cache miss + populates cache', async () => {
    const cache = makeStubCache();
    const r = await cacheFirst('/app/_next/static/y.js', cache, async () =>
      makeResponse('fresh'),
    );
    expect(r.body).toBe('fresh');
    const second = await cache.match('/app/_next/static/y.js');
    expect(second?.body).toBe('fresh');
  });

  test('does not cache non-OK responses', async () => {
    const cache = makeStubCache();
    await cacheFirst('/app/_next/static/missing.js', cache, async () =>
      makeResponse('Not Found', { ok: false, status: 404 }),
    );
    const cached = await cache.match('/app/_next/static/missing.js');
    expect(cached).toBeUndefined();
  });

  test('returns 504 stub when fetch throws and cache is empty', async () => {
    const cache = makeStubCache();
    const r = await cacheFirst('/app/_next/static/z.js', cache, async () => {
      throw new Error('offline');
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(504);
  });
});

describe('networkFirstWithOfflineFallback', () => {
  test('returns fresh response when network succeeds + populates runtime cache', async () => {
    const runtime = makeStubCache();
    const precache = makeStubCache();
    const r = await networkFirstWithOfflineFallback(
      '/app/term',
      runtime,
      precache,
      async () => makeResponse('live'),
    );
    expect(r.body).toBe('live');
    const cached = await runtime.match('/app/term');
    expect(cached?.body).toBe('live');
  });

  test('falls back to runtime cache on network failure', async () => {
    const runtime = makeStubCache({ '/app/term': makeResponse('stale') });
    const precache = makeStubCache();
    const r = await networkFirstWithOfflineFallback(
      '/app/term',
      runtime,
      precache,
      async () => { throw new Error('offline'); },
    );
    expect(r.body).toBe('stale');
  });

  test('falls back to precache offline.html when both fail', async () => {
    const runtime = makeStubCache();
    const precache = makeStubCache({ '/app/offline.html': makeResponse('offline-shell') });
    const r = await networkFirstWithOfflineFallback(
      '/app/term',
      runtime,
      precache,
      async () => { throw new Error('offline'); },
    );
    expect(r.body).toBe('offline-shell');
  });

  test('returns 503 when network down, no cache, no offline shell', async () => {
    const runtime = makeStubCache();
    const precache = makeStubCache();
    const r = await networkFirstWithOfflineFallback(
      '/app/term',
      runtime,
      precache,
      async () => { throw new Error('offline'); },
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  test('does NOT cache non-OK responses', async () => {
    const runtime = makeStubCache();
    const precache = makeStubCache();
    await networkFirstWithOfflineFallback(
      '/app/term',
      runtime,
      precache,
      async () => makeResponse('500', { ok: false, status: 500 }),
    );
    const cached = await runtime.match('/app/term');
    expect(cached).toBeUndefined();
  });
});
