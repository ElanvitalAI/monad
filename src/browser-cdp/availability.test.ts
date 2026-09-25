import { describe, expect, test } from 'bun:test';

import { CdpUnavailable } from './client.js';
import { probeUsableBrowserCdp } from './availability.js';

describe('probeUsableBrowserCdp', () => {
  test('returns an explicit unavailable reason without starting a client when no binary exists', async () => {
    const result = await probeUsableBrowserCdp({
      discoverBinary: () => null,
      createClient: async () => { throw new Error('must not create'); },
    });

    expect(result).toEqual({
      available: false,
      reason: 'no-chrome-binary',
      note: 'Chrome CDP unavailable: no-chrome-binary',
    });
  });

  test('converts a binary discovery exception into an explicit unavailable reason', async () => {
    const result = await probeUsableBrowserCdp({
      discoverBinary: () => { throw new Error('deterministic discovery failure'); },
      createClient: async () => { throw new Error('must not create'); },
    });

    expect(result).toEqual({
      available: false,
      reason: 'probe-failed: deterministic discovery failure',
      note: 'Chrome CDP unavailable: probe-failed: deterministic discovery failure',
    });
  });

  test('closes a successfully connected disposable client before reporting available', async () => {
    let closed = false;
    const result = await probeUsableBrowserCdp({
      discoverBinary: () => '/test/chrome',
      createClient: async () => ({ evaluate: async () => true, close: async () => { closed = true; } }),
    });

    expect(result.available).toBe(true);
    expect(closed).toBe(true);
  });

  test('returns the CDP connection failure as an unavailable reason', async () => {
    const result = await probeUsableBrowserCdp({
      discoverBinary: () => '/test/chrome',
      createClient: async () => { throw new CdpUnavailable('connect-failed: deterministic test'); },
    });

    expect(result).toEqual({
      available: false,
      reason: 'connect-failed: deterministic test',
      note: 'Chrome CDP unavailable: connect-failed: deterministic test',
    });
  });
});
