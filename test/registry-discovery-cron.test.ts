// RFC #2161 FU A8 — discovery cron schedule via NEXUS.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  readCronIntervalMsFromEnv,
  startDiscoveryCron,
} from '../src/registry/discovery/cron.js';
import type { DiscoverySnapshot } from '../src/registry/discovery/runner.js';

const EMPTY_SNAPSHOT: DiscoverySnapshot = {
  version: 1,
  generatedAt: '2026-05-11T00:00:00.000Z',
  sources: [],
  models: [],
};

beforeEach(() => {
  delete process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS;
});

afterEach(() => {
  delete process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS;
});

describe('readCronIntervalMsFromEnv', () => {
  test('unset env → 0 (dormant)', () => {
    expect(readCronIntervalMsFromEnv({})).toBe(0);
  });

  test('non-integer → 0', () => {
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: 'abc' })).toBe(0);
  });

  test('negative / zero → 0', () => {
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: '0' })).toBe(0);
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: '-5000' })).toBe(0);
  });

  test('below MIN clamps up to 60s', () => {
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: '500' })).toBe(60_000);
  });

  test('above MAX clamps down to 24h', () => {
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: String(999 * 86_400_000) })).toBe(86_400_000);
  });

  test('in-range value passes through', () => {
    expect(readCronIntervalMsFromEnv({ MONAD_DISCOVERY_CRON_INTERVAL_MS: '3600000' })).toBe(3_600_000);
  });
});

describe('startDiscoveryCron', () => {
  test('dormant when env unset · stop() + triggerNow() still work', async () => {
    const calls: number[] = [];
    const runFn = async () => {
      calls.push(Date.now());
      return { snapshot: EMPTY_SNAPSHOT };
    };
    const handle = startDiscoveryCron({ runFn, fireImmediately: false });
    expect(handle.intervalMs).toBe(0);
    handle.stop();  // no-op
    await handle.triggerNow();
    expect(calls.length).toBe(1);
  });

  test('fires immediately on start when intervalMs is set', async () => {
    let immediateCalls = 0;
    const runFn = async () => {
      immediateCalls += 1;
      return { snapshot: EMPTY_SNAPSHOT };
    };
    // Fake setInterval so the test doesn't actually schedule anything;
    // we only verify the immediate-fire branch.
    const handle = startDiscoveryCron({
      intervalMs: 3_600_000,
      runFn,
      setTimer: ((_fn: () => void, _ms: number) => 0 as unknown) as typeof setInterval,
      clearTimer: (() => { /* noop */ }) as typeof clearInterval,
    });
    // Yield once so the void-fired tick resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(immediateCalls).toBe(1);
    expect(handle.intervalMs).toBe(3_600_000);
    handle.stop();
  });

  test('intervalMs override beats env', () => {
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = '120000';
    const handle = startDiscoveryCron({
      intervalMs: 300_000,
      runFn: async () => ({ snapshot: EMPTY_SNAPSHOT }),
      setTimer: (() => 0 as unknown) as typeof setInterval,
      clearTimer: (() => {}) as typeof clearInterval,
      fireImmediately: false,
    });
    expect(handle.intervalMs).toBe(300_000);
    handle.stop();
  });

  test('failed tick is caught + onTick reports ok:false', async () => {
    const errors: string[] = [];
    const handle = startDiscoveryCron({
      runFn: async () => { throw new Error('boom'); },
      onTick: (r) => {
        if (!r.ok) errors.push(r.error ?? 'no-error');
      },
    });
    await handle.triggerNow();
    expect(errors).toEqual(['boom']);
    handle.stop();
  });

  test('onTick fires with snapshot on success', async () => {
    const seen: DiscoverySnapshot[] = [];
    const handle = startDiscoveryCron({
      runFn: async () => ({ snapshot: EMPTY_SNAPSHOT }),
      onTick: (r) => { if (r.snapshot) seen.push(r.snapshot); },
    });
    await handle.triggerNow();
    expect(seen.length).toBe(1);
    expect(seen[0]?.version).toBe(1);
    handle.stop();
  });

  test('stop() is idempotent', () => {
    let clearCalls = 0;
    const handle = startDiscoveryCron({
      intervalMs: 60_000,
      runFn: async () => ({ snapshot: EMPTY_SNAPSHOT }),
      setTimer: (() => 0 as unknown) as typeof setInterval,
      clearTimer: (() => { clearCalls += 1; }) as typeof clearInterval,
      fireImmediately: false,
    });
    handle.stop();
    handle.stop();   // second call should not bump clearCalls
    expect(clearCalls).toBe(1);
  });

  test('setTimer is invoked with the resolved interval', () => {
    let capturedMs = 0;
    const handle = startDiscoveryCron({
      intervalMs: 120_000,
      runFn: async () => ({ snapshot: EMPTY_SNAPSHOT }),
      setTimer: ((_fn: () => void, ms: number) => {
        capturedMs = ms;
        return 0 as unknown;
      }) as typeof setInterval,
      clearTimer: (() => {}) as typeof clearInterval,
      fireImmediately: false,
    });
    expect(capturedMs).toBe(120_000);
    handle.stop();
  });
});
