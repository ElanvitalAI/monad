import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  createPushcutClient,
  loadPushcutConfig,
  configPermissionWarning,
  PUSHCUT_API_BASE,
  _resetPushcutClientForTesting,
  initPushcutClient,
  getPushcutClient,
} from '../src/pushcut/client.js';

function tmpConfig(body: Record<string, unknown>): string {
  const dir = joinPath(tmpdir(), `monad-pushcut-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const path = joinPath(dir, 'pushcut.json');
  writeFileSync(path, JSON.stringify(body), 'utf-8');
  return path;
}

afterEach(() => {
  _resetPushcutClientForTesting();
});

describe('loadPushcutConfig', () => {
  test('missing file returns null', () => {
    expect(loadPushcutConfig('/nonexistent/pushcut.json')).toBeNull();
  });

  test('malformed JSON returns null (no throw)', () => {
    const dir = joinPath(tmpdir(), `monad-pushcut-bad-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = joinPath(dir, 'pushcut.json');
    writeFileSync(p, '{not valid}', 'utf-8');
    expect(loadPushcutConfig(p)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test('valid config roundtrips', () => {
    const p = tmpConfig({
      apiKey: 'pc_test_abc',
      defaultDeviceIds: ['iPhone-A', 'iPad'],
      allowedNotificationNames: ['ping', 'confirm'],
    });
    const cfg = loadPushcutConfig(p);
    expect(cfg?.apiKey).toBe('pc_test_abc');
    expect(cfg?.defaultDeviceIds).toEqual(['iPhone-A', 'iPad']);
    expect(cfg?.allowedNotificationNames).toEqual(['ping', 'confirm']);
    rmSync(p, { force: true });
  });

  test('empty apiKey → null', () => {
    const p = tmpConfig({ apiKey: '' });
    expect(loadPushcutConfig(p)).toBeNull();
    rmSync(p, { force: true });
  });
});

describe('configPermissionWarning', () => {
  test('returns warning for world-readable file', () => {
    const p = tmpConfig({ apiKey: 'x' });
    chmodSync(p, 0o644);
    const warn = configPermissionWarning(p);
    expect(warn).not.toBeNull();
    expect(warn).toContain('chmod 600');
    rmSync(p, { force: true });
  });

  test('returns null for 600 file', () => {
    const p = tmpConfig({ apiKey: 'x' });
    chmodSync(p, 0o600);
    expect(configPermissionWarning(p)).toBeNull();
    rmSync(p, { force: true });
  });
});

describe('createPushcutClient', () => {
  test('unconfigured → every call fails fast', async () => {
    const c = createPushcutClient({ config: null });
    expect(c.configured).toBe(false);
    const r = await c.notify('x', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pushcut-not-configured');
  });

  test('configured → POSTs to api.pushcut.io with API-Key header', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = createPushcutClient({
      config: { apiKey: 'pc_abc', defaultDeviceIds: ['X'] },
      fetchImpl: fakeFetch,
    });
    const r = await c.notify('hello', { title: 'Hi', text: 'world' });
    expect(r.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`${PUSHCUT_API_BASE}/notifications/hello`);
    const headers = (requests[0]!.init.headers as Record<string, string>);
    expect(headers['API-Key']).toBe('pc_abc');
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.title).toBe('Hi');
    expect(body.devices).toEqual(['X']);
  });

  test('allowedNotificationNames blocks unlisted names', async () => {
    const c = createPushcutClient({
      config: { apiKey: 'x', allowedNotificationNames: ['only-this'] },
      fetchImpl: (async () => new Response('', { status: 200 })) as any,
    });
    const r = await c.notify('other-name', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not-allowed/);
  });

  test('non-2xx response captured with httpStatus + body', async () => {
    const fakeFetch = (async () => new Response('rate limited', { status: 429 })) as any;
    const c = createPushcutClient({ config: { apiKey: 'x' }, fetchImpl: fakeFetch });
    const r = await c.notify('x', {});
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(429);
    expect(r.body).toBe('rate limited');
    expect(r.reason).toBe('http-429');
  });

  test('network error wrapped as non-ok result', async () => {
    const fakeFetch = (async () => { throw new Error('ENOTFOUND'); }) as any;
    const c = createPushcutClient({ config: { apiKey: 'x' }, fetchImpl: fakeFetch });
    const r = await c.notify('x', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ENOTFOUND');
  });

  test('execute openUrl → /execute with openUrl body', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }) as any;
    const c = createPushcutClient({ config: { apiKey: 'x' }, fetchImpl: fakeFetch });
    const r = await c.execute('openUrl', { url: 'https://example.com' });
    expect(r.ok).toBe(true);
    expect(requests[0]!.url).toBe(`${PUSHCUT_API_BASE}/execute`);
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.type).toBe('openUrl');
    expect(body.url).toBe('https://example.com');
  });

  test('execute runShortcut with input', async () => {
    const requests: RequestInit[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      requests.push(init);
      return new Response('', { status: 200 });
    }) as any;
    const c = createPushcutClient({ config: { apiKey: 'x' }, fetchImpl: fakeFetch });
    const r = await c.execute('runShortcut', { shortcut: 'take-photo', input: 'front-cam' });
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(requests[0]!.body));
    expect(body.shortcut).toBe('take-photo');
    expect(body.input).toBe('front-cam');
  });

  test('execute missing required fields', async () => {
    const c = createPushcutClient({ config: { apiKey: 'x' }, fetchImpl: (async () => new Response('')) as any });
    expect((await c.execute('openUrl', {})).reason).toBe('missing-url');
    expect((await c.execute('runShortcut', {})).reason).toBe('missing-shortcut');
  });

  test('singleton init + get', () => {
    initPushcutClient({ config: null });
    const a = getPushcutClient();
    const b = getPushcutClient();
    expect(a).toBe(b);
    _resetPushcutClientForTesting();
    const c = getPushcutClient();
    expect(c).not.toBe(a);
  });
});
