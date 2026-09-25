import { describe, expect, test } from 'bun:test';

import { runPwaStop } from '../src/cli/pwa-stop';
import type { TailscaleProbe } from '../src/nexus/onboarding/tailscale-probe.js';

const TS_INSTALLED: TailscaleProbe = {
  installed: true,
  alive: true,
  binary: '/opt/homebrew/bin/tailscale',
  hostname: 'mbp',
  magicDnsHost: 'mbp.tail-abc.ts.net',
  ips: ['100.64.0.2'],
  backendState: 'Running',
};
const TS_MISSING: TailscaleProbe = { installed: false, alive: false };

interface CapturedOut {
  log: (s: string) => void;
  error: (s: string) => void;
  logs: string[];
  errors: string[];
}

function makeOut(): CapturedOut {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => logs.push(s),
    error: (s) => errors.push(s),
    logs,
    errors,
  };
}

describe('runPwaStop', () => {
  test('cascade order: share reset → dev stop → nexus stop on the happy path', async () => {
    const out = makeOut();
    const order: string[] = [];
    const r = await runPwaStop({
      out,
      resolveNexusPwaFn: () => ({ status: 'registered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', source: 'local' }),
      shareProbeFn: async () => { order.push('probe'); return TS_INSTALLED; },
      shareResetFn: async (_binary, port) => { order.push(`reset:${port}`); return { exitCode: 0 }; },
      devStopFn: async () => {
        order.push('dev');
        return { exitCode: 0, killed: true };
      },
      nexusStopFn: async () => {
        order.push('nexus');
        return { exitCode: 0 };
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.devKilled).toBe(true);
    expect(r.nexusStopped).toBe(true);
    expect(r.shareReset).toBe(true);
    expect(r.shareUnmount).toEqual({ status: 'success', port: 31416, source: 'nexus' });
    expect(order).toEqual(['probe', 'reset:31416', 'dev', 'nexus']);
  });

  test('uses an explicit port instead of daemon resolution', async () => {
    const resetPorts: number[] = [];
    const r = await runPwaStop({
      out: makeOut(),
      port: 31417,
      resolveNexusPwaFn: () => ({ status: 'registered', loopback: 'http://127.0.0.1:31416/app/', url: 'http://127.0.0.1:31416/app/', source: 'local' }),
      shareProbeFn: async () => TS_INSTALLED,
      shareResetFn: async (_binary, port) => { resetPorts.push(port); return { exitCode: 0 }; },
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
    });
    expect(resetPorts).toEqual([31417]);
    expect(r.shareUnmount).toEqual({ status: 'success', port: 31417, source: 'explicit' });
  });

  test('skips share reset silently when tailscale is not installed', async () => {
    const out = makeOut();
    let resetCalls = 0;
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_MISSING,
      shareResetFn: async (_binary, _port) => { resetCalls += 1; return { exitCode: 0 }; },
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
    });
    expect(resetCalls).toBe(0);
    expect(r.shareReset).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  test('share reset non-zero exit is reported as an unmount failure', async () => {
    const out = makeOut();
    const r = await runPwaStop({
      out,
      port: 31415,
      shareProbeFn: async () => TS_INSTALLED,
      shareResetFn: async (_binary, _port) => ({ exitCode: 1 }),
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
    });
    expect(r.exitCode).toBe(0);
    expect(r.shareReset).toBe(true);
    expect(r.shareUnmount).toEqual({ status: 'failed', port: 31415, source: 'explicit', exitCode: 1 });
    expect(out.logs.some((l) => l.includes('share unmount exit 1'))).toBe(true);
    expect(out.errors).toEqual([]);
  });

  test('share reset throw is reported as an unmount failure and preserves the cleanup cascade', async () => {
    const out = makeOut();
    const order: string[] = [];
    const r = await runPwaStop({
      out,
      port: 31417,
      shareProbeFn: async () => { order.push('probe'); return TS_INSTALLED; },
      shareResetFn: async (_binary, _port) => { order.push('reset'); throw new Error('tailscale reset failed'); },
      readLockFn: () => ({ pid: 33333 }),
      unregisterFn: (pid) => { order.push(`unregister:${pid}`); },
      devStopFn: async () => { order.push('dev'); return { exitCode: 0, killed: false }; },
      nexusStopFn: async () => { order.push('nexus'); return { exitCode: 0 }; },
    });
    expect(r.exitCode).toBe(0);
    expect(r.shareReset).toBe(true);
    expect(r.shareUnmount).toEqual({
      status: 'failed',
      port: 31417,
      source: 'explicit',
      error: 'tailscale reset failed',
    });
    expect(r.shareUnmount).not.toEqual({ status: 'skipped', reason: 'tailscale-unavailable' });
    expect(r.unregisteredPid).toBe(33333);
    expect(order).toEqual(['probe', 'reset', 'unregister:33333', 'dev', 'nexus']);
    expect(out.logs.some((line) => line.includes('share unmount failed'))).toBe(true);
  });

  test('missing daemon port skips unmount and continues registry, dev, and nexus cleanup', async () => {
    const order: string[] = [];
    let resetCalls = 0;
    const r = await runPwaStop({
      out: makeOut(),
      resolveNexusPwaFn: () => ({ status: 'absent', reason: 'daemon-absent' }),
      shareProbeFn: async () => { order.push('probe'); return TS_INSTALLED; },
      shareResetFn: async (_binary, _port) => { resetCalls += 1; return { exitCode: 0 }; },
      readLockFn: () => ({ pid: 33333 }),
      unregisterFn: (pid) => { order.push(`unregister:${pid}`); },
      devStopFn: async () => { order.push('dev'); return { exitCode: 0, killed: false }; },
      nexusStopFn: async () => { order.push('nexus'); return { exitCode: 0 }; },
    });
    expect(resetCalls).toBe(0);
    expect(r.shareUnmount).toEqual({ status: 'skipped', reason: 'pwa-port-unknown' });
    expect(order).not.toContain('probe');
    expect(r.unregisteredPid).toBe(33333);
    expect(order).toEqual(['unregister:33333', 'dev', 'nexus']);
  });

  test('resolver failure skips unmount without blocking the stop cascade', async () => {
    const order: string[] = [];
    let resetCalls = 0;
    const r = await runPwaStop({
      out: makeOut(),
      resolveNexusPwaFn: () => { throw new Error('resolver failure'); },
      shareProbeFn: async () => { order.push('probe'); return TS_INSTALLED; },
      shareResetFn: async (_binary, _port) => { resetCalls += 1; return { exitCode: 0 }; },
      devStopFn: async () => { order.push('dev'); return { exitCode: 0, killed: false }; },
      nexusStopFn: async () => { order.push('nexus'); return { exitCode: 0 }; },
    });
    expect(resetCalls).toBe(0);
    expect(r.shareUnmount).toEqual({ status: 'skipped', reason: 'pwa-query-failed' });
    expect(order).not.toContain('probe');
    expect(order).toEqual(['dev', 'nexus']);
  });

  test('P4 — unregister fires with the lock pid before SIGINT', async () => {
    const out = makeOut();
    const unregistered: number[] = [];
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_INSTALLED,
      shareResetFn: async (_binary, _port) => ({ exitCode: 0 }),
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
      readLockFn: () => ({ pid: 33333 }),
      unregisterFn: (pid) => { unregistered.push(pid); },
    });
    expect(r.exitCode).toBe(0);
    expect(r.unregisteredPid).toBe(33333);
    expect(unregistered).toEqual([33333]);
  });

  test('P4 — no lock file → no unregister, no throw', async () => {
    const out = makeOut();
    const unregistered: number[] = [];
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_INSTALLED,
      shareResetFn: async (_binary, _port) => ({ exitCode: 0 }),
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
      readLockFn: () => null,
      unregisterFn: (pid) => { unregistered.push(pid); },
    });
    expect(r.exitCode).toBe(0);
    expect(r.unregisteredPid).toBeUndefined();
    expect(unregistered).toEqual([]);
  });

  test('share probe throwing does not block the cascade', async () => {
    const out = makeOut();
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => { throw new Error('tailscale probe blew up'); },
      shareResetFn: async (_binary, _port) => ({ exitCode: 0 }),
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
    });
    expect(r.exitCode).toBe(0);
    expect(r.shareReset).toBe(false);
  });

  test('runs nexus stop even when dev stop fails', async () => {
    const out = makeOut();
    const order: string[] = [];
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_MISSING,
      devStopFn: async () => {
        order.push('dev');
        return { exitCode: 1, killed: false };
      },
      nexusStopFn: async () => {
        order.push('nexus');
        return { exitCode: 0 };
      },
    });
    expect(r.exitCode).toBe(1);
    expect(r.devKilled).toBe(false);
    expect(r.nexusStopped).toBe(true);
    expect(order).toEqual(['dev', 'nexus']);
  });

  test('reports nexusStopped=false when nexus stop fails', async () => {
    const out = makeOut();
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_MISSING,
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 4 }),
    });
    expect(r.exitCode).toBe(1);
    expect(r.devKilled).toBe(false);
    expect(r.nexusStopped).toBe(false);
  });

  test('no-op cascade still returns exit 0 when both legs are clean', async () => {
    const out = makeOut();
    const r = await runPwaStop({
      out,
      shareProbeFn: async () => TS_MISSING,
      devStopFn: async () => ({ exitCode: 0, killed: false }),
      nexusStopFn: async () => ({ exitCode: 0 }),
    });
    expect(r.exitCode).toBe(0);
    expect(r.devKilled).toBe(false);
    expect(r.nexusStopped).toBe(true);
  });
});
