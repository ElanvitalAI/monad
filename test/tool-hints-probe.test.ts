import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ProbeSpec } from '../src/native-tool-catalog.js';
import {
  ensureProbed,
  getProbeResult,
  probeOk,
  refreshProbe,
  resetProbes,
  setProbeResultForTesting,
} from '../src/tool-hints/probe.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetProbes();
});

afterEach(() => {
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = val;
  }
  resetProbes();
});

describe('probe — env', () => {
  test('probeOk returns true when env var is set', () => {
    process.env.TEST_PROBE_KEY = 'present';
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_KEY' };
    expect(probeOk(probe)).toBe(true);
  });

  test('probeOk returns false when env var is missing', () => {
    delete process.env.TEST_PROBE_KEY_MISSING;
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_KEY_MISSING' };
    expect(probeOk(probe)).toBe(false);
  });

  test('probeOk returns false when env var is empty / whitespace', () => {
    process.env.TEST_PROBE_EMPTY = '   ';
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_EMPTY' };
    expect(probeOk(probe)).toBe(false);
  });

  test('env probe cached with Infinity TTL by default', () => {
    process.env.TEST_PROBE_TTL = '1';
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_TTL' };
    probeOk(probe);
    const firstResult = getProbeResult(probe);
    // Second call 1 hour later still uses cache (Infinity TTL).
    probeOk(probe, Date.now() + 3_600_000);
    const secondResult = getProbeResult(probe);
    expect(firstResult?.lastRunAt).toBe(secondResult?.lastRunAt);
  });
});

describe('probe — cli', () => {
  test('cli probe succeeds for /usr/bin/true', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/usr/bin/true' } };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(true);
  });

  test('cli probe fails for a nonexistent binary', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/nonexistent/binary-xyz-mh-test' } };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('cli probe fails for /usr/bin/false (exit 1)', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/usr/bin/false' } };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(false);
  });

  test('probeOk is false on first call for cli (fail-closed), schedules async refresh', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/usr/bin/true' } };
    // First sync call: no cache, returns false.
    expect(probeOk(probe)).toBe(false);
    // Let the async refresh complete.
    await ensureProbed(probe);
    // Subsequent sync call: cache populated.
    expect(probeOk(probe)).toBe(true);
  });
});

describe('probe — http (mocked via Bun.serve)', () => {
  test('http probe returns true on 200', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
    const probe: ProbeSpec = { kind: 'http', http: { url: `http://localhost:${server.port}/` } };
    try {
      const result = await ensureProbed(probe);
      expect(result.ok).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test('http probe returns false on 500', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('bad', { status: 500 }) });
    const probe: ProbeSpec = { kind: 'http', http: { url: `http://localhost:${server.port}/` } };
    try {
      const result = await ensureProbed(probe);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('500');
    } finally {
      server.stop(true);
    }
  });

  test('http probe fails on timeout', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        await new Promise(r => setTimeout(r, 200));
        return new Response('late');
      },
    });
    const probe: ProbeSpec = { kind: 'http', http: { url: `http://localhost:${server.port}/`, timeoutMs: 30 } };
    try {
      const result = await ensureProbed(probe);
      expect(result.ok).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe('probe — custom', () => {
  test('custom returning true', async () => {
    const probe: ProbeSpec = { kind: 'custom', custom: () => true };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(true);
  });

  test('custom returning Promise<false>', async () => {
    const probe: ProbeSpec = { kind: 'custom', custom: async () => false };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(false);
  });

  test('custom throwing is caught and reported', async () => {
    const probe: ProbeSpec = { kind: 'custom', custom: () => { throw new Error('boom'); } };
    const result = await ensureProbed(probe);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('boom');
  });
});

describe('probe — TTL + caching', () => {
  test('cli probe re-runs after TTL expires', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/usr/bin/true' }, ttlMs: 50 };
    const first = await ensureProbed(probe);
    await new Promise(r => setTimeout(r, 80));
    // probeOk past TTL: returns cached briefly but kicks off refresh;
    // after async refresh, result updates.
    probeOk(probe);
    const second = await ensureProbed(probe);
    expect(second.lastRunAt).toBeGreaterThan(first.lastRunAt);
  });

  test('probeOk survives across many calls without re-running env probe', () => {
    process.env.TEST_PROBE_NOLOOP = '1';
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_NOLOOP' };
    probeOk(probe);
    const firstRun = getProbeResult(probe)!.lastRunAt;
    for (let i = 0; i < 100; i++) probeOk(probe);
    expect(getProbeResult(probe)!.lastRunAt).toBe(firstRun);
  });

  test('refreshProbe bypasses cache', async () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: '/usr/bin/true' } };
    const first = await ensureProbed(probe);
    await new Promise(r => setTimeout(r, 5));
    const second = await refreshProbe(probe);
    expect(second.lastRunAt).toBeGreaterThan(first.lastRunAt);
  });
});

describe('probe — onFail propagation', () => {
  test('result carries onFail from probe spec (default hide)', () => {
    process.env.TEST_PROBE_FAIL = '1';
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_FAIL' };
    probeOk(probe);
    expect(getProbeResult(probe)?.onFail).toBe('hide');
  });

  test('explicit onFail disable is preserved in the result', () => {
    delete process.env.TEST_PROBE_FAIL_DISABLE;
    const probe: ProbeSpec = { kind: 'env', env: 'TEST_PROBE_FAIL_DISABLE', onFail: 'disable' };
    probeOk(probe);
    expect(getProbeResult(probe)?.onFail).toBe('disable');
  });
});

describe('probe — inflight dedup', () => {
  test('concurrent ensureProbed calls for the same spec share one run', async () => {
    let calls = 0;
    const probe: ProbeSpec = {
      kind: 'custom',
      custom: async () => { calls++; await new Promise(r => setTimeout(r, 20)); return true; },
    };
    await Promise.all([ensureProbed(probe), ensureProbed(probe), ensureProbed(probe)]);
    expect(calls).toBe(1);
  });
});

describe('probe — test seam', () => {
  test('setProbeResultForTesting injects deterministic cache entry', () => {
    const probe: ProbeSpec = { kind: 'cli', cli: { cmd: 'something' } };
    setProbeResultForTesting(probe, { ok: true });
    expect(probeOk(probe)).toBe(true);
    setProbeResultForTesting(probe, { ok: false, reason: 'faked' });
    expect(probeOk(probe)).toBe(false);
    expect(getProbeResult(probe)?.reason).toBe('faked');
  });
});
