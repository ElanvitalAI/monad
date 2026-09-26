import { afterEach, describe, expect, test } from 'bun:test';

import {
  createHitlCallbackServer,
  type HitlCallbackServer,
} from '../src/hitl/callback-server.js';

let server: HitlCallbackServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

function mk(opts: Parameters<typeof createHitlCallbackServer>[0] = {}) {
  return createHitlCallbackServer({ port: 0, ...opts });
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
  return { status: res.status, body: await res.text() };
}

describe('HitlCallbackServer', () => {
  test('awaitCallback resolves true when POST answers', async () => {
    server = mk();
    await server.start();
    const p = server.awaitCallback('req-a');
    const r = await post(`${server.url()}/hitl/callback/req-a`, { answer: true });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(await p).toBe(true);
  });

  test('awaitCallback resolves false', async () => {
    server = mk();
    await server.start();
    const p = server.awaitCallback('req-b');
    await post(`${server.url()}/hitl/callback/req-b`, { answer: false });
    expect(await p).toBe(false);
  });

  test('awaitCallback resolves null on timeout', async () => {
    server = mk({ defaultTimeoutMs: 50 });
    await server.start();
    const p = server.awaitCallback('req-timeout');
    expect(await p).toBeNull();
    expect(server.pending()).not.toContain('req-timeout');
  });

  test('POST to unknown requestId returns 404', async () => {
    server = mk();
    await server.start();
    const r = await post(`${server.url()}/hitl/callback/ghost`, { answer: true });
    expect(r.status).toBe(404);
  });

  test('invalid JSON returns 400', async () => {
    server = mk();
    await server.start();
    const r = await fetch(`${server.url()}/hitl/callback/req`, {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status).toBe(400);
  });

  test('non-boolean answer returns 400', async () => {
    server = mk();
    await server.start();
    const r = await post(`${server.url()}/hitl/callback/req`, { answer: 'maybe' });
    expect(r.status).toBe(400);
  });

  test('secret enforcement: missing header returns 401', async () => {
    server = mk({ secret: 'topsecret' });
    await server.start();
    const p = server.awaitCallback('req-s');
    const r = await post(`${server.url()}/hitl/callback/req-s`, { answer: true });
    expect(r.status).toBe(401);
    // pending promise is still alive; clean up by firing with secret.
    await post(`${server.url()}/hitl/callback/req-s`, { answer: true }, { 'x-elanous-secret': 'topsecret' });
    expect(await p).toBe(true);
  });

  test('secret enforcement: correct header accepted', async () => {
    server = mk({ secret: 's3cret' });
    await server.start();
    const p = server.awaitCallback('req');
    const r = await post(`${server.url()}/hitl/callback/req`, { answer: false }, { 'x-elanous-secret': 's3cret' });
    expect(r.status).toBe(200);
    expect(await p).toBe(false);
  });

  test('healthz responds ok', async () => {
    server = mk();
    await server.start();
    const r = await fetch(`${server.url()}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  test('unknown paths return 404', async () => {
    server = mk();
    await server.start();
    const r = await fetch(`${server.url()}/other`);
    expect(r.status).toBe(404);
  });

  test('stop() rejects pending requests with null', async () => {
    server = mk({ defaultTimeoutMs: 60_000 });
    await server.start();
    const p = server.awaitCallback('pending');
    await server.stop();
    server = null;
    expect(await p).toBeNull();
  });

  test('onAnswer audit hook fires with the parsed request', async () => {
    const seen: Array<{ requestId: string; answer: boolean }> = [];
    server = mk({ onAnswer: (r) => seen.push(r) });
    await server.start();
    const p = server.awaitCallback('req');
    await post(`${server.url()}/hitl/callback/req`, { answer: true });
    await p;
    expect(seen).toEqual([{ requestId: 'req', answer: true }]);
  });

  test('duplicate awaitCallback for the same id returns null immediately', async () => {
    server = mk({ defaultTimeoutMs: 60_000 });
    await server.start();
    const first = server.awaitCallback('dup');
    const second = await server.awaitCallback('dup');
    expect(second).toBeNull();
    // Resolve the first so we clean up.
    await post(`${server.url()}/hitl/callback/dup`, { answer: false });
    expect(await first).toBe(false);
  });

  test('url() returns null before start and populated after', async () => {
    const s = mk();
    expect(s.url()).toBeNull();
    await s.start();
    expect(s.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await s.stop();
  });

  test('EADDRINUSE on default port scans forward and onPortShift fires', async () => {
    // Occupy an OS-assigned port first, then try to bind to that exact
    // port — the scanner should slide to port+1.
    const squatter = createHitlCallbackServer({ port: 0, portScanRange: 1 });
    await squatter.start();
    const taken = squatter.port()!;
    let shift: { wanted: number; actual: number } | null = null;
    server = createHitlCallbackServer({
      port: taken,
      portScanRange: 5,
      onPortShift: (info) => { shift = info; },
    });
    try {
      await server.start();
      expect(server.port()).toBe(taken + 1);
      expect(shift).toEqual({ wanted: taken, actual: taken + 1 });
    } finally {
      await squatter.stop();
    }
  });

  test('portScanRange exhausted throws EADDRINUSE', async () => {
    const squatter = createHitlCallbackServer({ port: 0, portScanRange: 1 });
    await squatter.start();
    const taken = squatter.port()!;
    const s = createHitlCallbackServer({ port: taken, portScanRange: 1 });
    try {
      let thrown: NodeJS.ErrnoException | null = null;
      try {
        await s.start();
      } catch (e) {
        thrown = e as NodeJS.ErrnoException;
      }
      expect(thrown).not.toBeNull();
      expect(thrown!.code).toBe('EADDRINUSE');
    } finally {
      await squatter.stop();
    }
  });
});
