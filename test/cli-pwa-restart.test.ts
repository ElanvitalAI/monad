import { describe, expect, test } from 'bun:test';
import { hostname } from 'node:os';

import { runPwaRestart } from '../src/cli/pwa-restart.js';
import type { NexusLockMeta } from '../src/nexus/supervisor/lock.js';

function sink(): { log: (s: string) => void; error: (s: string) => void; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    log: (s) => { logs.push(s); },
    error: (s) => { errors.push(s); },
    logs,
    errors,
  };
}

function localNexusLock(pid = 1234): NexusLockMeta {
  return { pid, host: hostname(), startedAt: '2026-05-07T00:00:00.000Z', label: 'nexus' };
}

interface Step { kind: 'build' | 'stop' | 'start'; payload?: unknown }

describe('runPwaRestart', () => {
  test('auto-detect HMR mode when dev lock is alive — stop + start hmr, no rebuild', async () => {
    const out = sink();
    const steps: Step[] = [];
    const result = await runPwaRestart({
      out,
      readDevLockFn: () => ({ pid: 4242 }),
      isAliveDevPidFn: () => true,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      buildFn: async () => { steps.push({ kind: 'build' }); return { exitCode: 0, cwd: '/tmp', durationMs: 1 }; },
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: true, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async (o) => { steps.push({ kind: 'start', payload: o.mode }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(0);
    expect(result.mode).toBe('hmr');
    expect(steps.map((s) => s.kind)).toEqual(['stop', 'start']);
    expect(steps[1]?.payload).toBe('hmr');
    expect(out.logs.join('\n')).toContain('mode=hmr');
    expect(out.logs.join('\n')).toContain('auto-detected');
  });

  test('auto-detect static mode when no dev lock is alive', async () => {
    const steps: Step[] = [];
    const result = await runPwaRestart({
      readDevLockFn: () => null,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async (o) => { steps.push({ kind: 'start', payload: o.mode }); return { exitCode: 0 }; },
    });
    expect(result.mode).toBe('static');
    expect(steps[1]?.payload).toBe('static');
  });

  test('auto-detect skips HMR mode when dev lock is stale (pid not alive)', async () => {
    const result = await runPwaRestart({
      readDevLockFn: () => ({ pid: 9999 }),
      isAliveDevPidFn: () => false,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => ({ exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }),
      startFn: async () => ({ exitCode: 0 }),
    });
    expect(result.mode).toBe('static');
  });

  test('explicit --mode static overrides live dev lock', async () => {
    const steps: Step[] = [];
    const result = await runPwaRestart({
      mode: 'static',
      readDevLockFn: () => ({ pid: 4242 }),
      isAliveDevPidFn: () => true,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: true, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async (o) => { steps.push({ kind: 'start', payload: o.mode }); return { exitCode: 0 }; },
    });
    expect(result.mode).toBe('static');
    expect(steps[1]?.payload).toBe('static');
  });

  test('--rebuild runs build before stop+start', async () => {
    const steps: Step[] = [];
    const result = await runPwaRestart({
      rebuild: true,
      readDevLockFn: () => null,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      buildFn: async () => { steps.push({ kind: 'build' }); return { exitCode: 0, cwd: '/tmp', durationMs: 1 }; },
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async () => { steps.push({ kind: 'start' }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(0);
    expect(steps.map((s) => s.kind)).toEqual(['build', 'stop', 'start']);
  });

  test('--rebuild failure short-circuits before stop/start', async () => {
    const steps: Step[] = [];
    const result = await runPwaRestart({
      rebuild: true,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      buildFn: async () => { steps.push({ kind: 'build' }); return { exitCode: 7, cwd: '/tmp', durationMs: 1 }; },
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async () => { steps.push({ kind: 'start' }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(7);
    expect(steps.map((s) => s.kind)).toEqual(['build']);
  });

  test('default flow runs no build (legacy 30s rebuild gone)', async () => {
    let buildCalls = 0;
    await runPwaRestart({
      readDevLockFn: () => null,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      buildFn: async () => { buildCalls += 1; return { exitCode: 0, cwd: '/tmp', durationMs: 1 }; },
      stopFn: async (_opts) => ({ exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }),
      startFn: async () => ({ exitCode: 0 }),
    });
    expect(buildCalls).toBe(0);
  });

  test('remote nexus lock holder aborts before stop or start', async () => {
    const out = sink();
    const steps: Step[] = [];
    const result = await runPwaRestart({
      out,
      readDevLockFn: () => null,
      readNexusLockFn: () => ({ pid: 55, host: 'remote-host', startedAt: '2026-05-07T00:00:00.000Z', label: 'nexus' }),
      isAliveNexusLockFn: () => true,
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async () => { steps.push({ kind: 'start' }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(1);
    expect(steps).toEqual([]);
    expect(out.errors.join('\n')).toContain('remote host');
  });

  test('local nexus lock does not block (stop cascade clears it)', async () => {
    const steps: Step[] = [];
    const result = await runPwaRestart({
      readDevLockFn: () => null,
      readNexusLockFn: () => localNexusLock(7777),
      isAliveNexusLockFn: () => true,
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async () => { steps.push({ kind: 'start' }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(0);
    expect(steps.map((s) => s.kind)).toEqual(['stop', 'start']);
  });

  test('stop failure short-circuits before start', async () => {
    const out = sink();
    const steps: Step[] = [];
    const result = await runPwaRestart({
      out,
      readDevLockFn: () => null,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => { steps.push({ kind: 'stop' }); return { exitCode: 1, devKilled: false, nexusStopped: false, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }; },
      startFn: async () => { steps.push({ kind: 'start' }); return { exitCode: 0 }; },
    });
    expect(result.exitCode).toBe(1);
    expect(steps.map((s) => s.kind)).toEqual(['stop']);
    expect(out.errors.join('\n')).toContain('stop cascade reported failure');
  });

  test('start opts pass through (mode + httpPort + loopback + devPort)', async () => {
    let captured: unknown;
    await runPwaRestart({
      mode: 'hmr',
      httpPort: 9999,
      loopback: true,
      devPort: 4321,
      toolCwd: '/tmp/tool',
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => ({ exitCode: 0, devKilled: false, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }),
      startFn: async (o) => { captured = o; return { exitCode: 0 }; },
    });
    expect(captured).toMatchObject({
      mode: 'hmr',
      httpPort: 9999,
      loopback: true,
      devPort: 4321,
      toolCwd: '/tmp/tool',
    });
  });

  test('start failure propagates exit code with detected mode (hmr path)', async () => {
    const result = await runPwaRestart({
      readDevLockFn: () => ({ pid: 1 }),
      isAliveDevPidFn: () => true,
      readNexusLockFn: () => null,
      isAliveNexusLockFn: () => false,
      stopFn: async (_opts) => ({ exitCode: 0, devKilled: true, nexusStopped: true, shareReset: false, shareUnmount: { status: 'skipped', reason: 'pwa-port-unknown' } }),
      startFn: async () => ({ exitCode: 42 }),
    });
    expect(result.exitCode).toBe(42);
    expect(result.mode).toBe('hmr');
  });
});
