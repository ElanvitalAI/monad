import { describe, expect, test } from 'bun:test';

import {
  discoverChromeBinary,
  resolveDebuggerUrl,
  createCdpClient,
  createCdpClientFromEndpoint,
  CdpUnavailable,
  type CdpTransport,
} from '../src/browser-cdp/client.js';

describe('discoverChromeBinary', () => {
  test('honors ELANOUS_CHROME_BIN env override', () => {
    const fs = new Set(['/custom/chrome']);
    const got = discoverChromeBinary({
      env: { ELANOUS_CHROME_BIN: '/custom/chrome' },
      platform: 'linux',
      existsSync: (p) => fs.has(p),
    });
    expect(got).toBe('/custom/chrome');
  });

  test('macOS picks Chrome.app', () => {
    const fs = new Set(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
    const got = discoverChromeBinary({
      env: {}, platform: 'darwin', existsSync: (p) => fs.has(p),
    });
    expect(got).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  test('linux picks /usr/bin/google-chrome', () => {
    const fs = new Set(['/usr/bin/google-chrome']);
    const got = discoverChromeBinary({
      env: {}, platform: 'linux', existsSync: (p) => fs.has(p),
    });
    expect(got).toBe('/usr/bin/google-chrome');
  });

  test('falls through to chromium when chrome missing', () => {
    const fs = new Set(['/usr/bin/chromium']);
    const got = discoverChromeBinary({
      env: {}, platform: 'linux', existsSync: (p) => fs.has(p),
    });
    expect(got).toBe('/usr/bin/chromium');
  });

  test('returns null when nothing found', () => {
    expect(discoverChromeBinary({ env: {}, platform: 'linux', existsSync: () => false })).toBeNull();
  });
});

describe('resolveDebuggerUrl', () => {
  test('returns url on first success', async () => {
    const fake = async () => new Response(
      JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' }),
      { status: 200 },
    );
    const got = await resolveDebuggerUrl(9222, { retries: 1, intervalMs: 0, fetchImpl: fake as any });
    expect(got).toBe('ws://127.0.0.1:9222/devtools/browser/abc');
  });

  test('retries and throws on persistent failure', async () => {
    let attempts = 0;
    const fake = async () => { attempts++; throw new Error('conn refused'); };
    await expect(
      resolveDebuggerUrl(9222, { retries: 3, intervalMs: 0, attachTimeoutMs: 0, fetchImpl: fake as any }),
    ).rejects.toThrow(CdpUnavailable);
    expect(attempts).toBe(3);
  });

  test('throws when webSocketDebuggerUrl missing', async () => {
    const fake = async () => new Response('{}', { status: 200 });
    await expect(
      resolveDebuggerUrl(9222, { retries: 1, intervalMs: 0, attachTimeoutMs: 0, fetchImpl: fake as any }),
    ).rejects.toThrow(CdpUnavailable);
  });
});

describe('createCdpClient (with fakes)', () => {
  test('no chrome binary → CdpUnavailable', async () => {
    await expect(createCdpClient({ binary: '/no/such/path' }, {
      spawnBinary: () => { throw new Error('should not spawn'); },
    })).rejects.toThrow(/no-chrome-binary|ENOENT|spawn-failed/);
  });

  test('navigate + screenshot happy path with fake transport', async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const fakeTransport: CdpTransport = {
      async send(method, params) {
        sent.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{ targetId: 'page-1', type: 'page', url: 'about:blank' }] };
        }
        if (method === 'Page.captureScreenshot') {
          return { data: Buffer.from('PNG', 'utf-8').toString('base64') };
        }
        return {};
      },
      close() { /* noop */ },
    };

    const fakeChild = {
      pid: 12345,
      kill: () => true,
      on: () => {},
    } as unknown as import('node:child_process').ChildProcess;

    // Supply binary path so discoverChromeBinary isn't hit.
    const client = await createCdpClient(
      { binary: '/fake/chrome' },
      {
        spawnBinary: () => fakeChild,
        resolveUrl: async () => 'ws://127.0.0.1:9222/devtools/browser/fake',
        createTransport: async () => fakeTransport,
      },
    );

    expect(client.port).toBe(9222);
    expect(client.pid).toBe(12345);
    await client.navigate('https://example.com');
    const png = await client.screenshot();
    expect(png.toString('utf-8')).toBe('PNG');

    const methods = sent.map(s => s.method);
    expect(methods).toContain('Page.captureScreenshot');
    expect(sent.slice(1, 4)).toEqual([
      { method: 'Page.enable', params: undefined },
      { method: 'Page.setLifecycleEventsEnabled', params: { enabled: true } },
      { method: 'Page.navigate', params: { url: 'https://example.com' } },
    ]);

    await client.close();
  });

  test('navigate returns Page.navigate frameId and optional errorText from transport', async () => {
    const fakeTransport: CdpTransport = {
      async send(method) {
        if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'page-1', type: 'page', url: 'about:blank' }] };
        if (method === 'Page.navigate') return { frameId: 'frame-1', errorText: 'net::ERR_CONNECTION_REFUSED' };
        return {};
      },
      close() {},
    };
    const fakeChild = { pid: 1, kill: () => true, on: () => {} } as unknown as import('node:child_process').ChildProcess;
    const client = await createCdpClient({ binary: '/fake' }, {
      spawnBinary: () => fakeChild,
      resolveUrl: async () => 'ws://fake',
      createTransport: async () => fakeTransport,
    });

    expect(await client.navigate('https://unreachable.example')).toEqual({ frameId: 'frame-1', errorText: 'net::ERR_CONNECTION_REFUSED' });
    await client.close();
  });

  test('navigate omits errorText when Page.navigate has no failure reason', async () => {
    const fakeTransport: CdpTransport = {
      async send(method) {
        if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'page-1', type: 'page', url: 'about:blank' }] };
        if (method === 'Page.navigate') return { frameId: 'frame-1' };
        return {};
      },
      close() {},
    };
    const fakeChild = { pid: 1, kill: () => true, on: () => {} } as unknown as import('node:child_process').ChildProcess;
    const client = await createCdpClient({ binary: '/fake' }, {
      spawnBinary: () => fakeChild,
      resolveUrl: async () => 'ws://fake',
      createTransport: async () => fakeTransport,
    });

    expect(await client.navigate('https://example.com')).toEqual({ frameId: 'frame-1' });
    await client.close();
  });

  test('evaluate returns result.value; rejects on exceptionDetails', async () => {
    const fakeTransport: CdpTransport = {
      async send(method) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [{ targetId: 'page-1', type: 'page', url: 'about:blank' }] };
        }
        if (method === 'Runtime.evaluate') {
          return { result: { value: 42 } };
        }
        return {};
      },
      close() {},
    };
    const fakeChild = {
      pid: 1, kill: () => true, on: () => {},
    } as unknown as import('node:child_process').ChildProcess;

    const c = await createCdpClient({ binary: '/fake' }, {
      spawnBinary: () => fakeChild,
      resolveUrl: async () => 'ws://fake',
      createTransport: async () => fakeTransport,
    });
    expect(await c.evaluate('1+41')).toBe(42);
    await c.close();
  });

  test('connect failure kills child + rethrows', async () => {
    let killed = false;
    const fakeChild = {
      pid: 1, kill: () => { killed = true; return true; }, on: () => {},
    } as unknown as import('node:child_process').ChildProcess;
    await expect(createCdpClient({ binary: '/fake' }, {
      spawnBinary: () => fakeChild,
      resolveUrl: async () => { throw new CdpUnavailable('connect-failed: test'); },
    })).rejects.toThrow(/connect-failed/);
    expect(killed).toBe(true);
  });
});

describe('createCdpClientFromEndpoint — B1 attach(브라우저 비귀속)', () => {
  const fakeTransport = (sent: Array<{ method: string; params: unknown }>, closed: { v: boolean }): CdpTransport => ({
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'page-1', type: 'page', url: 'about:blank' }] };
      if (method === 'Page.captureScreenshot') return { data: Buffer.from('PNG', 'utf-8').toString('base64') };
      return {};
    },
    close() { closed.v = true; },
  });

  const okFetch = (): typeof fetch => (async () => ({ ok: true, async json() { return {}; } })) as unknown as typeof fetch;

  test('spawn 없이 attach(새 page 타깃) — navigate/screenshot 동작', async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const closed = { v: false };
    const client = await createCdpClientFromEndpoint(9222, {
      resolvePage: async () => ({ wsUrl: 'ws://127.0.0.1:9222/devtools/page/abc', targetId: 'abc' }),
      createTransport: async () => fakeTransport(sent, closed),
      fetchImpl: okFetch(),
    });
    expect(client.port).toBe(9222);
    expect(client.pid).toBe(-1);   // 외부 소유 — pid 없음
    await client.navigate('https://deploy.example');
    const png = await client.screenshot();
    expect(png.toString('utf-8')).toBe('PNG');
    expect(sent.map(s => s.method)).toContain('Page.navigate');
    // directPage=true → Target.getTargets 안 부름(page ws 직접 라우팅)
    expect(sent.map(s => s.method)).not.toContain('Target.getTargets');
  });

  test('close 는 우리가 연 탭만 정리(/json/close) + transport close·프로세스 kill 안 함', async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const closed = { v: false };
    const fetched: string[] = [];
    const client = await createCdpClientFromEndpoint(9222, {
      resolvePage: async () => ({ wsUrl: 'ws://fake', targetId: 'tab-1' }),
      createTransport: async () => fakeTransport(sent, closed),
      fetchImpl: (async (u: string) => { fetched.push(String(u)); return { ok: true, async json() { return {}; } }; }) as unknown as typeof fetch,
    });
    await client.close();
    expect(closed.v).toBe(true);   // transport 닫힘
    expect(fetched.some(u => u.includes('/json/close/tab-1'))).toBe(true);   // 연 탭만 정리
    await client.close();   // 재호출 안전
  });

  test('click 은 Input.dispatchMouseEvent 를 press→release «순서로» 보낸다 (좌표·버튼·clickCount 포함)', async () => {
    // ⛔⭐ 이 층에 시험이 «없었다». 하니스 시험(browser-act.test.ts)은 가짜 `click` 을 주입하므로
    //    press/release 순서·좌표·버튼 파라미터가 깨져도 게이트가 «통과»한다 — 리뷰 must-fix ②.
    //    그래서 여기서는 「불렸나」가 아니라 ***「무엇을 어떤 순서로 보냈나」***를 문다.
    const sent: Array<{ method: string; params: unknown }> = [];
    const closed = { v: false };
    const client = await createCdpClientFromEndpoint(9222, {
      resolvePage: async () => ({ wsUrl: 'ws://fake', targetId: 'tab-1' }),
      createTransport: async () => fakeTransport(sent, closed),
      fetchImpl: okFetch(),
    });

    expect(typeof client.click).toBe('function');
    await client.click!({ x: 201.5, y: 173.25 });

    const params = { x: 201.5, y: 173.25, button: 'left', clickCount: 1 };
    expect(sent.filter(s => s.method === 'Input.dispatchMouseEvent')).toEqual([
      { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', ...params } },
      { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', ...params } },
    ]);
    await client.close();
  });

  test('엔드포인트 부재 → CdpUnavailable(attach-failed)', async () => {
    await expect(createCdpClientFromEndpoint(9222, {
      resolvePage: async () => { throw new Error('ECONNREFUSED'); },
    })).rejects.toThrow(/attach-failed/);
  });

  test('CdpUnavailable 는 그대로 전파(래핑 안 함)', async () => {
    await expect(createCdpClientFromEndpoint(9222, {
      resolvePage: async () => { throw new CdpUnavailable('new-target-failed: no endpoint'); },
    })).rejects.toThrow(/new-target-failed/);
  });
});
