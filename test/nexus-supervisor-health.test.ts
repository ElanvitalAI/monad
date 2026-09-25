// NEXUS · supervisor health loop tests (Phase N-2 PR ε)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startHealthLoop,
  runHealthCheck,
  createDefaultHealthProbeBackend,
  type HealthProbeBackend,
} from '../src/nexus/supervisor/health.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { createNexusState } from '../src/nexus/state/state.js';
import type { TabSpec } from '../src/nexus/kinds/types.js';

let tmpRoot: string;
let prevEnv: string | undefined;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-n2-health-'));
  prevEnv = process.env.MONAD_NEXUS_DIR;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setupRegistry(spec: TabSpec) {
  const state = createNexusState({ nexusVersion: '0.5.0', phase: 'test' });
  const registry = new TabRegistry(state);
  registry.register(spec);
  return { state, registry };
}

function makeProbes(overrides: Partial<HealthProbeBackend> = {}): HealthProbeBackend {
  return {
    async http() { return true; },
    async socket() { return true; },
    async fileMtime() { return true; },
    async ipcPing() { return true; },
    async processAlive() { return true; },
    ...overrides,
  };
}

describe('startHealthLoop · spec-kind routing', () => {
  test('kind="never" returns no-op handle', async () => {
    const { state, registry } = setupRegistry({
      id: 'svc:1',
      kind: 'daemon',
      label: 'svc#1',
      health: { kind: 'never', intervalMs: 1000 },
    });
    const handle = startHealthLoop({ state, registry, tabId: 'svc:1' });
    expect(await handle.probeOnce()).toBe(true);
    handle.stop(); // idempotent
    handle.stop();
  });

  test('throws when tab not registered', () => {
    const state = createNexusState({ nexusVersion: '0.5.0', phase: 'test' });
    const registry = new TabRegistry(state);
    expect(() => startHealthLoop({ state, registry, tabId: 'missing' })).toThrow(/tab not found/);
  });

  test('http probe failures eventually transition to unhealthy', async () => {
    let probeCount = 0;
    const probes = makeProbes({
      async http() { probeCount += 1; return false; },
    });
    const { state, registry } = setupRegistry({
      id: 'pwa:1',
      kind: 'pwa-host',
      label: 'pwa',
      health: { kind: 'http', intervalMs: 50, staleAfterMs: 0, spec: { url: 'http://localhost:9999' } },
    });
    let unhealthyCalls: { id: string; reason: string }[] = [];
    const handle = startHealthLoop({
      state, registry, tabId: 'pwa:1', probes,
      onUnhealthy: (id, reason) => unhealthyCalls.push({ id, reason }),
    });
    expect(await handle.probeOnce()).toBe(false);
    expect(probeCount).toBe(1);
    expect(registry.get('pwa:1')!.status).toBe('unhealthy');
    expect(unhealthyCalls).toHaveLength(1);
    expect(unhealthyCalls[0]).toEqual({ id: 'pwa:1', reason: 'http-stale' });
    expect(state.events.find((e) => e.kind === 'tab.unhealthy')).toBeDefined();
    handle.stop();
  });

  test('successful probe resets the failure window', async () => {
    let healthy = false;
    const probes = makeProbes({ async http() { return healthy; } });
    const { state, registry } = setupRegistry({
      id: 'svc',
      kind: 'daemon',
      label: 'svc',
      health: { kind: 'http', intervalMs: 50, staleAfterMs: 0, spec: { url: 'http://x' } },
    });
    const handle = startHealthLoop({ state, registry, tabId: 'svc', probes });
    await handle.probeOnce();
    expect(registry.get('svc')!.status).toBe('unhealthy');
    healthy = true;
    // Reset status so we can verify it doesn't get re-flagged immediately
    registry.patch('svc', { status: 'active' });
    await handle.probeOnce();
    expect(registry.get('svc')!.status).toBe('active');
    handle.stop();
  });

  test('does not re-emit unhealthy when already unhealthy', async () => {
    const probes = makeProbes({ async http() { return false; } });
    const { state, registry } = setupRegistry({
      id: 's',
      kind: 'daemon',
      label: 's',
      health: { kind: 'http', intervalMs: 50, staleAfterMs: 0, spec: { url: 'http://x' } },
    });
    const handle = startHealthLoop({ state, registry, tabId: 's', probes });
    await handle.probeOnce();
    await handle.probeOnce();
    await handle.probeOnce();
    const events = state.events.filter((e) => e.kind === 'tab.unhealthy');
    expect(events).toHaveLength(1);
    handle.stop();
  });
});

describe('runHealthCheck · per-kind dispatch', () => {
  test('http delegates to probes.http', async () => {
    let called = 0;
    const probes = makeProbes({ async http() { called += 1; return true; } });
    const tab = { spec: { id: 'x', kind: 'daemon' as const, label: 'x' }, status: 'active' as const, restartCount: 0, restartCountWindowStart: 0 };
    const ok = await runHealthCheck(probes, { kind: 'http', intervalMs: 1, spec: { url: 'http://x' } }, tab);
    expect(ok).toBe(true);
    expect(called).toBe(1);
  });

  test('socket dispatches', async () => {
    const probes = makeProbes({ async socket() { return false; } });
    const tab = { spec: { id: 'x', kind: 'daemon' as const, label: 'x' }, status: 'active' as const, restartCount: 0, restartCountWindowStart: 0 };
    const ok = await runHealthCheck(probes, { kind: 'socket', intervalMs: 1, spec: { port: 9 } }, tab);
    expect(ok).toBe(false);
  });

  test('process-alive uses tab pid', async () => {
    let pidArg: number | undefined;
    const probes = makeProbes({ async processAlive(pid) { pidArg = pid; return true; } });
    const tab = { spec: { id: 'x', kind: 'daemon' as const, label: 'x' }, status: 'active' as const, restartCount: 0, restartCountWindowStart: 0, pid: 7777 };
    await runHealthCheck(probes, { kind: 'process-alive', intervalMs: 1 }, tab);
    expect(pidArg).toBe(7777);
  });

  test('never always returns true without invoking probes', async () => {
    let called = 0;
    const probes = makeProbes({ async http() { called += 1; return false; } });
    const tab = { spec: { id: 'x', kind: 'chat' as const, label: 'x' }, status: 'active' as const, restartCount: 0, restartCountWindowStart: 0 };
    const ok = await runHealthCheck(probes, { kind: 'never', intervalMs: 1 }, tab);
    expect(ok).toBe(true);
    expect(called).toBe(0);
  });
});

describe('createDefaultHealthProbeBackend · file-mtime', () => {
  test('fresh file is healthy', async () => {
    const probes = createDefaultHealthProbeBackend();
    const path = join(tmpRoot, 'fresh.txt');
    writeFileSync(path, 'hello');
    expect(await probes.fileMtime({ path }, 60_000)).toBe(true);
  });

  test('old file is unhealthy', async () => {
    const probes = createDefaultHealthProbeBackend();
    const path = join(tmpRoot, 'old.txt');
    writeFileSync(path, 'old');
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(path, old, old);
    expect(await probes.fileMtime({ path }, 60_000)).toBe(false);
  });

  test('missing file is unhealthy', async () => {
    const probes = createDefaultHealthProbeBackend();
    expect(await probes.fileMtime({ path: join(tmpRoot, 'no.txt') }, 60_000)).toBe(false);
  });
});
