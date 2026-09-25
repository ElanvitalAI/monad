import { describe, expect, test } from 'bun:test';

import {
  handleDevProxyHttpRequest,
  pathMatchesDevProxy,
} from '../src/nexus/api/dev-proxy';

describe('pathMatchesDevProxy', () => {
  test('matches /app and /app/<...>', () => {
    expect(pathMatchesDevProxy('/app')).toBe(true);
    expect(pathMatchesDevProxy('/app/')).toBe(true);
    expect(pathMatchesDevProxy('/app/chat')).toBe(true);
    expect(pathMatchesDevProxy('/app/chat/index.html')).toBe(true);
  });

  test('matches /_next/<...>', () => {
    expect(pathMatchesDevProxy('/_next')).toBe(true);
    expect(pathMatchesDevProxy('/_next/static/chunk.js')).toBe(true);
    expect(pathMatchesDevProxy('/_next/webpack-hmr')).toBe(true);
  });

  test('matches /__nextjs and /__nextjs_<name>', () => {
    expect(pathMatchesDevProxy('/__nextjs')).toBe(true);
    expect(pathMatchesDevProxy('/__nextjs/dev-overlay')).toBe(true);
    // Next.js dev RPCs use underscore, not slash, after the prefix.
    // Webterm dogfood (2026-05-07) caught these 405-ing against nexus
    // instead of reaching next-dev: font preloads + stack-frame RPC.
    expect(pathMatchesDevProxy('/__nextjs_font/geist-latin.woff2')).toBe(true);
    expect(pathMatchesDevProxy('/__nextjs_original-stack-frames')).toBe(true);
    expect(pathMatchesDevProxy('/__nextjs_dev-data')).toBe(true);
  });

  test('does not match daemon API or other paths', () => {
    expect(pathMatchesDevProxy('/v1/health')).toBe(false);
    expect(pathMatchesDevProxy('/v1/sessions')).toBe(false);
    expect(pathMatchesDevProxy('/')).toBe(false);
    expect(pathMatchesDevProxy('/apple')).toBe(false); // /app prefix but no boundary
    expect(pathMatchesDevProxy('/_nextjs')).toBe(false);
  });
});

describe('handleDevProxyHttpRequest', () => {
  test('forwards to upstream + relays status / body / headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('hello world', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-custom': 'upstream-value',
        },
      });
    };
    const req = new Request('http://nexus.local:31415/app/chat?foo=bar', {
      method: 'GET',
      headers: { 'host': 'nexus.local:31415', 'accept': 'text/html' },
    });
    const url = new URL(req.url);

    const res = await handleDevProxyHttpRequest(req, url, {
      upstream: 'http://localhost:3210',
      fetchFn: fetchFn as typeof fetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:3210/app/chat?foo=bar');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
    expect(res.headers.get('x-custom')).toBe('upstream-value');
  });

  test('strips host + adds X-Forwarded-* headers', async () => {
    let received: Headers | null = null;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      received = init?.headers as Headers;
      return new Response('ok', { status: 200 });
    };
    const req = new Request('http://nexus.local:31415/app/foo', {
      method: 'GET',
      headers: { 'host': 'nexus.local:31415' },
    });
    await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(received).not.toBeNull();
    expect(received!.get('host')).toBeNull();
    expect(received!.get('x-forwarded-host')).toBe('nexus.local:31415');
    expect(received!.get('x-forwarded-proto')).toBe('http');
  });

  test('forwards POST body with duplex half', async () => {
    const calls: Array<{ method?: string; bodyText: string }> = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body;
      let bodyText = '';
      if (body instanceof ReadableStream) {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        bodyText = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      } else if (typeof body === 'string') {
        bodyText = body;
      }
      calls.push({ method: init?.method, bodyText });
      return new Response('ok', { status: 200 });
    };
    const req = new Request('http://nexus.local:31415/app/api', {
      method: 'POST',
      headers: { 'host': 'nexus.local:31415', 'content-type': 'text/plain' },
      body: 'payload-here',
    });
    await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].bodyText).toBe('payload-here');
  });

  test('502 with hint when upstream is unreachable', async () => {
    const fetchFn = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3210');
    }) as unknown as typeof fetch;
    const req = new Request('http://nexus.local:31415/app/chat');
    const res = await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210',
      fetchFn,
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('dev_proxy_upstream_unreachable');
    expect(body.upstream).toBe('http://localhost:3210');
    expect(body.hint).toContain('monad nexus pwa dev');
  });

  test('strips hop-by-hop headers in both directions', async () => {
    let received: Headers | null = null;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      received = init?.headers as Headers;
      return new Response('ok', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'connection': 'close',
          'transfer-encoding': 'chunked',
          'x-app': 'value',
        },
      });
    };
    const req = new Request('http://nexus.local:31415/app/foo', {
      method: 'GET',
      headers: {
        'host': 'nexus.local:31415',
        'connection': 'keep-alive',
        'upgrade': 'h2c',
      },
    });
    const res = await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(received!.get('connection')).toBeNull();
    expect(received!.get('upgrade')).toBeNull();
    expect(res.headers.get('connection')).toBeNull();
    expect(res.headers.get('transfer-encoding')).toBeNull();
    expect(res.headers.get('x-app')).toBe('value');
  });

  test('strips Content-Encoding + Content-Length when upstream auto-decompressed body', async () => {
    // Simulates the Bun `fetch` real-world behavior: it fetches a
    // gzip-compressed upstream response, transparently decompresses
    // the stream, but exposes the *original* Content-Encoding and
    // Content-Length headers (compressed-byte length + 'gzip' label).
    // If the proxy forwards those verbatim, the browser tries to
    // decode the already-plain body as gzip → ERR_CONTENT_DECODING_FAILED.
    const PLAIN = '<!DOCTYPE html><html>plain after decompress</html>';
    const fetchFn = async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(PLAIN, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',          // ← upstream's original label
          'content-length': '12345',           // ← compressed byte count
          'cache-control': 'no-store',
        },
      });
    const req = new Request('http://nexus.local:31415/app/', { method: 'GET' });
    const res = await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
    // Other entity headers are preserved.
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Body forwards plain (post-decompress) bytes.
    expect(await res.text()).toBe(PLAIN);
  });

  test('upstream trailing slash is normalised', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('ok', { status: 200 });
    };
    const req = new Request('http://nexus.local:31415/app/foo');
    await handleDevProxyHttpRequest(req, new URL(req.url), {
      upstream: 'http://localhost:3210/',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(calls[0]).toBe('http://localhost:3210/app/foo');
  });
});
