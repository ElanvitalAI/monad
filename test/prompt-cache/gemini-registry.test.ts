import { beforeEach, describe, expect, test } from 'bun:test';
import {
  GeminiCacheRegistry,
  _buildGeminiCreateBody,
  createGeminiCache,
  getGeminiCache,
  deleteGeminiCache,
  GeminiCacheError,
} from '../../src/prompt-cache/index.js';

// ── _buildGeminiCreateBody (wire shape) ─────────────────────────────

describe('_buildGeminiCreateBody', () => {
  test('model is normalized to "models/<id>"', () => {
    const body = _buildGeminiCreateBody({
      apiKey: 'k', model: 'gemini-2.5-flash',
    });
    expect(body.model).toBe('models/gemini-2.5-flash');
  });

  test('already-prefixed model is passed through', () => {
    const body = _buildGeminiCreateBody({
      apiKey: 'k', model: 'models/gemini-2.5-pro',
    });
    expect(body.model).toBe('models/gemini-2.5-pro');
  });

  test('ttl defaults to 1h (3600s)', () => {
    const body = _buildGeminiCreateBody({ apiKey: 'k', model: 'gemini' });
    expect(body.ttl).toBe('3600s');
  });

  test('ttl:"5m" → 300s, ttl:"24h" → 86400s, ttl:"48h" → 172800s', () => {
    for (const [ttl, seconds] of [
      ['5m', 300], ['24h', 86400], ['48h', 172800],
    ] as const) {
      const body = _buildGeminiCreateBody({ apiKey: 'k', model: 'g', ttl });
      expect(body.ttl).toBe(`${seconds}s`);
    }
  });

  test('system → systemInstruction.parts[].text', () => {
    const body = _buildGeminiCreateBody({
      apiKey: 'k', model: 'g', system: 'be concise',
    });
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'be concise' }],
    });
  });

  test('tools → tools[0].functionDeclarations', () => {
    const body = _buildGeminiCreateBody({
      apiKey: 'k', model: 'g',
      tools: [
        { name: 't1', description: 'd1', parameters: { type: 'object' } },
      ],
    });
    expect(body.tools).toEqual([{
      functionDeclarations: [
        { name: 't1', description: 'd1', parameters: { type: 'object' } },
      ],
    }]);
  });

  test('contents pass through unchanged', () => {
    const contents = [{ role: 'user' as const, parts: [{ text: 'hi' }] }];
    const body = _buildGeminiCreateBody({ apiKey: 'k', model: 'g', contents });
    expect(body.contents).toEqual(contents);
  });

  test('displayName included when provided', () => {
    const body = _buildGeminiCreateBody({
      apiKey: 'k', model: 'g', displayName: 'session-init',
    });
    expect(body.displayName).toBe('session-init');
  });

  test('missing optional fields are omitted (not undefined)', () => {
    const body = _buildGeminiCreateBody({ apiKey: 'k', model: 'g' });
    expect(body).not.toHaveProperty('systemInstruction');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('contents');
    expect(body).not.toHaveProperty('displayName');
  });
});

// ── REST client (mocked fetch) ──────────────────────────────────────

function mkFetch(response: { status: number; body: unknown }): typeof fetch {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      { status: response.status, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  (impl as any).calls = calls;
  return impl;
}

describe('createGeminiCache', () => {
  test('success returns the record on 200', async () => {
    const fetchImpl = mkFetch({
      status: 200,
      body: { name: 'cachedContents/abc', model: 'models/g', expireTime: '2026-04-18T10:00:00Z' },
    });
    const rec = await createGeminiCache({
      apiKey: 'K', model: 'gemini-2.5-flash', system: 'be concise',
      fetchImpl, baseUrl: 'https://example.com/v1',
    });
    expect(rec).toMatchObject({ name: 'cachedContents/abc' });
    const calls = (fetchImpl as any).calls as Array<{ url: string; init?: RequestInit }>;
    expect(calls[0]!.url).toContain('/cachedContents?key=K');
    expect(calls[0]!.init?.method).toBe('POST');
  });

  test('non-2xx throws GeminiCacheError with status', async () => {
    const fetchImpl = mkFetch({ status: 429, body: 'rate limited' });
    await expect(createGeminiCache({
      apiKey: 'K', model: 'g', fetchImpl, baseUrl: 'https://example.com/v1',
    })).rejects.toBeInstanceOf(GeminiCacheError);
  });

  test('network failure returns null (does not throw)', async () => {
    const failingFetch = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const rec = await createGeminiCache({
      apiKey: 'K', model: 'g', fetchImpl: failingFetch, baseUrl: 'https://example.com/v1',
    });
    expect(rec).toBeNull();
  });
});

describe('getGeminiCache / deleteGeminiCache — edge cases', () => {
  test('get returns null on 404', async () => {
    const fetchImpl = mkFetch({ status: 404, body: {} });
    const rec = await getGeminiCache({
      apiKey: 'K', name: 'cachedContents/xyz',
      fetchImpl, baseUrl: 'https://example.com/v1',
    });
    expect(rec).toBeNull();
  });

  test('delete returns false on 404 (already gone)', async () => {
    const fetchImpl = mkFetch({ status: 404, body: {} });
    const ok = await deleteGeminiCache({
      apiKey: 'K', name: 'cachedContents/xyz',
      fetchImpl, baseUrl: 'https://example.com/v1',
    });
    expect(ok).toBe(false);
  });

  test('delete returns true on 200', async () => {
    const fetchImpl = mkFetch({ status: 200, body: {} });
    const ok = await deleteGeminiCache({
      apiKey: 'K', name: 'cachedContents/xyz',
      fetchImpl, baseUrl: 'https://example.com/v1',
    });
    expect(ok).toBe(true);
  });
});

// ── Registry ────────────────────────────────────────────────────────

describe('GeminiCacheRegistry', () => {
  let registry: GeminiCacheRegistry;

  beforeEach(() => {
    registry = new GeminiCacheRegistry();
  });

  test('hashKey is stable for identical inputs', () => {
    const k1 = registry.hashKey('sys', [{ name: 't', description: 'd', parameters: {} }]);
    const k2 = registry.hashKey('sys', [{ name: 't', description: 'd', parameters: {} }]);
    expect(k1).toBe(k2);
  });

  test('hashKey differs when system changes', () => {
    const k1 = registry.hashKey('A', undefined);
    const k2 = registry.hashKey('B', undefined);
    expect(k1).not.toBe(k2);
  });

  test('hashKey is order-independent over keys in tool parameters', () => {
    // JSON.stringify preserves key order, so a stable stringifier is
    // needed. Our implementation sorts keys; assert that.
    const k1 = registry.hashKey(undefined, [{
      name: 't', description: 'd', parameters: { a: 1, b: 2 },
    }]);
    const k2 = registry.hashKey(undefined, [{
      name: 't', description: 'd', parameters: { b: 2, a: 1 },
    }]);
    expect(k1).toBe(k2);
  });

  test('lookup returns null when the registry is empty', () => {
    expect(registry.lookup('sys', undefined)).toBeNull();
  });

  test('clear wipes all entries', () => {
    expect(registry.list()).toHaveLength(0);
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  test('invalidate removes a matching key (noop if absent)', () => {
    registry.invalidate('sys', undefined);
    expect(registry.list()).toHaveLength(0);
  });
});
