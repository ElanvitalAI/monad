// H6 P6 · Browser CDP provider tests.

import { describe, test, expect } from 'bun:test';
import { createBrowserCdpProvider } from '../src/capture/providers/browser-cdp-provider.js';
import type { CdpClient } from '../src/browser-cdp/client.js';

function fakeClient(opts: { alive?: boolean; screenshotReturns?: Buffer } = {}): CdpClient {
  return {
    port: 9222,
    pid: 12345,
    navigate: async () => ({ frameId: 'test-frame' }),
    screenshot: async () => opts.screenshotReturns ?? Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    evaluate: async () => null,
    setScriptExecutionDisabled: async () => {},
    close: async () => {},
    isAlive: opts.alive !== false,
  };
}

describe('browser-cdp provider · list', () => {
  test('no client · empty list (D10 isolation)', () => {
    const provider = createBrowserCdpProvider({ getClient: () => undefined });
    expect(provider.list()).toEqual([]);
  });

  test('client dead · empty list', () => {
    const provider = createBrowserCdpProvider({
      getClient: () => fakeClient({ alive: false }),
    });
    expect(provider.list()).toEqual([]);
  });

  test('live client · returns single page-0 descriptor', () => {
    const provider = createBrowserCdpProvider({
      getClient: () => fakeClient(),
    });
    const list = provider.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('browser-cdp:page-0');
    expect(list[0]!.formats).toEqual(['png']);
    expect(list[0]!.meta).toEqual({ pid: 12345, port: 9222 });
    expect(list[0]!.sourceRef).toEqual({
      kind: 'browser',
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    });
  });

  test('getClient throwing · empty list (defensive)', () => {
    const provider = createBrowserCdpProvider({
      getClient: () => { throw new Error('cdp boom'); },
    });
    expect(provider.list()).toEqual([]);
  });
});

describe('browser-cdp provider · snapshot', () => {
  test('happy path · returns base64 png', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const provider = createBrowserCdpProvider({
      getClient: () => fakeClient({ screenshotReturns: pngBytes }),
    });
    const snap = await provider.snapshot('browser-cdp:page-0', {});
    expect(snap.format).toBe('png');
    expect(snap.bodyBase64).toBe(pngBytes.toString('base64'));
    expect(snap.bytes).toBe(pngBytes.length);
    expect(snap.sourceRef).toEqual({
      kind: 'browser',
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    });
  });

  test('no client · clear error', async () => {
    const provider = createBrowserCdpProvider({ getClient: () => undefined });
    await expect(
      provider.snapshot('browser-cdp:page-0', {}),
    ).rejects.toThrow(/no client attached/);
  });

  test('non-png format rejected', async () => {
    const provider = createBrowserCdpProvider({ getClient: () => fakeClient() });
    await expect(
      provider.snapshot('browser-cdp:page-0', { format: 'text' }),
    ).rejects.toThrow(/only 'png'/);
  });

  test('unknown page id rejected', async () => {
    const provider = createBrowserCdpProvider({ getClient: () => fakeClient() });
    await expect(
      provider.snapshot('browser-cdp:page-99', {}),
    ).rejects.toThrow(/only page id/);
  });
});
