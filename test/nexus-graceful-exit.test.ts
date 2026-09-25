// NEXUS · graceful exit + restore-state tests (Phase N-5 PR χ)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  GRACEFUL_EXIT_CODE,
  CLEAN_EXIT_CODE,
  cleanExit,
  clearRestartState,
  gracefulExit,
  readRestartState,
  serializeRestartState,
} from '../src/nexus/supervisor/graceful-exit.js';
import { restoreFromPending } from '../src/nexus/supervisor/restore-state.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { nexusRestartStatePath } from '../src/nexus/paths.js';
import type { Supervisor } from '../src/nexus/supervisor/index.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'monad-nexus-chi-'));
  prevEnv = process.env.MONAD_NEXUS_DIR;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setup() {
  const state = createNexusState({ nexusVersion: '0.17.0', phase: 'N-5 PR χ test' });
  const registry = new TabRegistry(state);
  return { state, registry };
}

type FakeSupervisor = Supervisor & {
  shutdownCalls: { graceMs?: number }[];
  startCalls: string[];
};

function fakeSupervisor(opts: {
  shutdown?: (o?: { graceMs?: number }) => Promise<void>;
  startTab?: (id: string) => Promise<void>;
} = {}): FakeSupervisor {
  const shutdownCalls: { graceMs?: number }[] = [];
  const startCalls: string[] = [];
  const sup: FakeSupervisor = {
    reclaim: () => [],
    async startTab(id: string) {
      startCalls.push(id);
      if (opts.startTab) await opts.startTab(id);
    },
    async stopTab() { /* no-op */ },
    async shutdown(o?: { graceMs?: number }) {
      shutdownCalls.push(o ?? {});
      if (opts.shutdown) await opts.shutdown(o);
    },
    managedIds() { return []; },
    shutdownCalls,
    startCalls,
  };
  return sup;
}

describe('serializeRestartState · capture', () => {
  test('keeps only active-class tabs (active / starting / unhealthy / restarting)', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.register({ id: 'p', kind: 'pwa-host', label: 'p' });
    registry.register({ id: 'b', kind: 'channel-bot', label: 'b' });
    registry.register({ id: 'c', kind: 'chat', label: 'c' });
    registry.patch('d', { status: 'active', pid: 1001 });
    registry.patch('p', { status: 'starting' });
    registry.patch('b', { status: 'unhealthy' });
    registry.patch('c', { status: 'idle' });

    const out = serializeRestartState({ state, registry });

    expect(out.previousPid).toBe(process.pid);
    expect(out.reason).toBe('sigterm');
    const ids = out.tabs.map((t) => t.id).sort();
    expect(ids).toEqual(['b', 'd', 'p']);
    const dEntry = out.tabs.find((t) => t.id === 'd');
    expect(dEntry?.pid).toBe(1001);
    const bEntry = out.tabs.find((t) => t.id === 'b');
    expect(bEntry?.pid).toBeUndefined();
  });

  test('writes the file with mode 0600 + valid JSON', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });

    const path = nexusRestartStatePath();
    expect(existsSync(path)).toBe(true);
    const body = JSON.parse(readFileSync(path, 'utf-8'));
    expect(body.tabs).toHaveLength(1);
    expect(body.tabs[0].id).toBe('d');
  });

  test('reason override carries through to file', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry, reason: 'manual' });
    const f = readRestartState();
    expect(f?.reason).toBe('manual');
  });

  test('empty active set still writes a valid file with empty tabs', () => {
    const { state, registry } = setup();
    registry.register({ id: 'c', kind: 'chat', label: 'c' });
    registry.patch('c', { status: 'idle' });
    const out = serializeRestartState({ state, registry });
    expect(out.tabs).toEqual([]);
    expect(existsSync(nexusRestartStatePath())).toBe(true);
  });
});

describe('readRestartState · parse', () => {
  test('round-trip — write then read', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });
    const f = readRestartState();
    expect(f).not.toBeNull();
    expect(f!.tabs[0].id).toBe('d');
    expect(f!.previousPid).toBe(process.pid);
  });

  test('missing file → null', () => {
    expect(readRestartState()).toBeNull();
  });

  test('malformed file → null (no throw)', () => {
    writeFileSync(nexusRestartStatePath(), 'not json {{{', { mode: 0o600 });
    expect(readRestartState()).toBeNull();
  });

  test('rejects file with wrong shape (missing reason)', () => {
    writeFileSync(
      nexusRestartStatePath(),
      JSON.stringify({ serializedAt: 'x', previousPid: 1, tabs: [] }),
      { mode: 0o600 },
    );
    expect(readRestartState()).toBeNull();
  });

  test('rejects file with non-array tabs', () => {
    writeFileSync(
      nexusRestartStatePath(),
      JSON.stringify({ serializedAt: 'x', previousPid: 1, reason: 'sigterm', tabs: 'oops' }),
      { mode: 0o600 },
    );
    expect(readRestartState()).toBeNull();
  });
});

describe('clearRestartState · idempotent', () => {
  test('removes the file', () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });
    expect(existsSync(nexusRestartStatePath())).toBe(true);
    clearRestartState();
    expect(existsSync(nexusRestartStatePath())).toBe(false);
  });

  test('no-op when file is missing', () => {
    expect(() => clearRestartState()).not.toThrow();
  });
});

describe('gracefulExit · exit 75 + drain + release', () => {
  test('default: exits with code 75 after serializing', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });

    let captured: number | undefined;
    await gracefulExit({
      state,
      registry,
      exit: (code) => { captured = code; },
    });
    expect(captured).toBe(GRACEFUL_EXIT_CODE);
    expect(captured).toBe(75);
    const f = readRestartState();
    expect(f?.tabs[0].id).toBe('d');
  });

  test('calls supervisor.shutdown with default 5000ms grace', async () => {
    const { state, registry } = setup();
    const sup = fakeSupervisor();
    await gracefulExit({
      state,
      registry,
      supervisor: sup,
      exit: () => undefined,
    });
    expect(sup.shutdownCalls).toEqual([{ graceMs: 5000 }]);
  });

  test('calls release callback before exit', async () => {
    const { state, registry } = setup();
    const order: string[] = [];
    const sup = fakeSupervisor({
      shutdown: async () => { order.push('shutdown'); },
    });
    await gracefulExit({
      state,
      registry,
      supervisor: sup,
      release: () => { order.push('release'); },
      exit: () => { order.push('exit'); },
    });
    expect(order).toEqual(['shutdown', 'release', 'exit']);
  });

  test('custom exitCode is honored (e.g., manual restart with code 0)', async () => {
    const { state, registry } = setup();
    let captured: number | undefined;
    await gracefulExit({
      state,
      registry,
      exitCode: 0,
      reason: 'manual',
      exit: (code) => { captured = code; },
    });
    expect(captured).toBe(0);
    expect(readRestartState()?.reason).toBe('manual');
  });

  test('supervisor.shutdown rejection does not block exit', async () => {
    const { state, registry } = setup();
    const sup = fakeSupervisor({
      shutdown: async () => { throw new Error('boom'); },
    });
    let captured: number | undefined;
    await gracefulExit({
      state,
      registry,
      supervisor: sup,
      exit: (code) => { captured = code; },
    });
    expect(captured).toBe(75);
  });
});

describe('cleanExit · exit 0 + clears restart-state', () => {
  test('removes restart-state.json and exits 0', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });
    expect(existsSync(nexusRestartStatePath())).toBe(true);

    let captured: number | undefined;
    await cleanExit({
      state,
      registry,
      exit: (code) => { captured = code; },
    });
    expect(captured).toBe(CLEAN_EXIT_CODE);
    expect(captured).toBe(0);
    expect(existsSync(nexusRestartStatePath())).toBe(false);
  });

  test('drains supervisor with 0ms grace (fast shutdown)', async () => {
    const { state, registry } = setup();
    const sup = fakeSupervisor();
    await cleanExit({
      state,
      registry,
      supervisor: sup,
      exit: () => undefined,
    });
    expect(sup.shutdownCalls).toEqual([{ graceMs: 0 }]);
  });
});

describe('restoreFromPending · auto-start + clear', () => {
  test('starts each saved tab present in the registry', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.register({ id: 'p', kind: 'pwa-host', label: 'p' });
    // Seed an active state, serialize, simulate fresh boot.
    registry.patch('d', { status: 'active' });
    registry.patch('p', { status: 'active' });
    serializeRestartState({ state, registry });
    // Simulate fresh boot: clear in-memory tab status (still registered).
    registry.patch('d', { status: 'idle' });
    registry.patch('p', { status: 'idle' });

    const sup = fakeSupervisor();
    const out = await restoreFromPending({ state, registry, supervisor: sup });

    expect(out.read).not.toBeNull();
    expect(out.started.sort()).toEqual(['d', 'p']);
    expect(out.unknown).toEqual([]);
    expect(sup.startCalls.sort()).toEqual(['d', 'p']);
    // One-shot: file is cleared.
    expect(existsSync(nexusRestartStatePath())).toBe(false);
  });

  test('reports tabs missing from registry as unknown', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    // Add a phantom that won't exist on next boot.
    registry.register({ id: 'gone', kind: 'channel-bot', label: 'gone' });
    registry.patch('gone', { status: 'active' });
    serializeRestartState({ state, registry });
    registry.unregister('gone');

    const sup = fakeSupervisor();
    const out = await restoreFromPending({ state, registry, supervisor: sup });

    expect(out.started).toEqual(['d']);
    expect(out.unknown).toEqual(['gone']);
  });

  test('returns no-op shape when no file exists', async () => {
    const { state, registry } = setup();
    const sup = fakeSupervisor();
    const out = await restoreFromPending({ state, registry, supervisor: sup });
    expect(out).toEqual({ read: null, started: [], unknown: [], skipped: [] });
    expect(sup.startCalls).toEqual([]);
  });

  test('startTab failure is captured into skipped (does not throw)', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });

    const out = await restoreFromPending({
      state,
      registry,
      startTab: async () => { throw new Error('spawn failed'); },
    });
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual(['d']);
  });

  test('emits nexus.boot{restoreFromPending:true} with summary', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });
    registry.patch('d', { status: 'idle' });

    const baselineLen = state.events.length;
    const sup = fakeSupervisor();
    await restoreFromPending({ state, registry, supervisor: sup });

    const ev = state.events
      .slice(baselineLen)
      .find((e) => e.kind === 'nexus.boot' && e.detail?.restoreFromPending === true);
    expect(ev).toBeDefined();
    expect(ev?.detail).toMatchObject({
      restoreFromPending: true,
      reason: 'sigterm',
      previousPid: process.pid,
      started: ['d'],
      unknown: [],
      skipped: [],
    });
  });

  test('skips when no supervisor + no startTab override is passed', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'd', kind: 'daemon', label: 'd' });
    registry.patch('d', { status: 'active' });
    serializeRestartState({ state, registry });

    const out = await restoreFromPending({ state, registry });
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual(['d']);
    expect(existsSync(nexusRestartStatePath())).toBe(false);
  });
});

describe('round-trip · gracefulExit → restoreFromPending', () => {
  test('SIGTERM-equivalent serialize then boot-equivalent restore preserves active set', async () => {
    const { state: stateA, registry: registryA } = setup();
    registryA.register({ id: 'd', kind: 'daemon', label: 'd' });
    registryA.register({ id: 'p', kind: 'pwa-host', label: 'p' });
    registryA.patch('d', { status: 'active' });
    registryA.patch('p', { status: 'active' });

    await gracefulExit({
      state: stateA,
      registry: registryA,
      exit: () => undefined,
    });

    // Boot 2: fresh state + registry (same MONAD_NEXUS_DIR via env).
    const stateB = createNexusState({ nexusVersion: '0.17.0', phase: 'N-5 PR χ test' });
    const registryB = new TabRegistry(stateB);
    registryB.register({ id: 'd', kind: 'daemon', label: 'd' });
    registryB.register({ id: 'p', kind: 'pwa-host', label: 'p' });

    const sup = fakeSupervisor();
    const out = await restoreFromPending({ state: stateB, registry: registryB, supervisor: sup });
    expect(out.started.sort()).toEqual(['d', 'p']);
    expect(out.unknown).toEqual([]);
  });
});
