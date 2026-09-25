import { describe, expect, test } from 'bun:test';

import {
  createDevProxyRuntimeRef,
  tryHandleAdminDevProxy,
} from '../src/nexus/api/admin-dev-proxy';

describe('createDevProxyRuntimeRef', () => {
  test('starts null + accepts set / clear', () => {
    const ref = createDevProxyRuntimeRef();
    expect(ref.get()).toBeNull();
    ref.set({ upstream: 'http://localhost:3210' });
    expect(ref.get()).toEqual({ upstream: 'http://localhost:3210' });
    ref.set(null);
    expect(ref.get()).toBeNull();
  });
});

describe('tryHandleAdminDevProxy', () => {
  const url = (path: string) => new URL(`http://nexus.local${path}`);

  test('returns undefined for unrelated paths', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/health'),
      url('/v1/health'),
      { ref },
    );
    expect(res).toBeUndefined();
  });

  test('GET reports null when not active', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy'),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ upstream: null });
  });

  test('POST sets the ref + echoes upstream', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upstream: 'http://localhost:3210' }),
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ upstream: 'http://localhost:3210' });
    expect(ref.get()).toEqual({ upstream: 'http://localhost:3210' });
  });

  test('POST accepts https:// upstreams', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upstream: 'https://example.com' }),
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(200);
    expect(ref.get()).toEqual({ upstream: 'https://example.com' });
  });

  test('POST rejects non-http(s) upstreams', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ upstream: 'ftp://nope' }),
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(400);
    expect(ref.get()).toBeNull();
  });

  test('POST rejects empty / missing / non-string upstreams', async () => {
    const ref = createDevProxyRuntimeRef();
    const cases: unknown[] = [
      { upstream: '' },
      { upstream: null },
      { upstream: 1234 },
      {},
    ];
    for (const body of cases) {
      const res = await tryHandleAdminDevProxy(
        new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        url('/v1/nexus/admin/pwa-dev-proxy'),
        { ref },
      );
      expect(res!.status).toBe(400);
    }
    expect(ref.get()).toBeNull();
  });

  test('POST rejects malformed JSON body', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toBe('invalid_json');
  });

  test('DELETE clears the ref + echoes null', async () => {
    const ref = createDevProxyRuntimeRef();
    ref.set({ upstream: 'http://localhost:3210' });
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'DELETE',
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ upstream: null });
    expect(ref.get()).toBeNull();
  });

  test('DELETE on already-clear ref is idempotent', async () => {
    const ref = createDevProxyRuntimeRef();
    const res = await tryHandleAdminDevProxy(
      new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', {
        method: 'DELETE',
      }),
      url('/v1/nexus/admin/pwa-dev-proxy'),
      { ref },
    );
    expect(res!.status).toBe(200);
  });

  test('PUT / PATCH return 405', async () => {
    const ref = createDevProxyRuntimeRef();
    for (const method of ['PUT', 'PATCH']) {
      const res = await tryHandleAdminDevProxy(
        new Request('http://nexus.local/v1/nexus/admin/pwa-dev-proxy', { method }),
        url('/v1/nexus/admin/pwa-dev-proxy'),
        { ref },
      );
      expect(res!.status).toBe(405);
    }
  });
});
