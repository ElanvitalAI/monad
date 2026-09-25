// H5 Phase 1 Step E · spawn-embodied-agent-in-vw tests.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  findLiveSessionById,
  findLiveSessionByPaneId,
  initSpawnEmbodiedAgentInVW,
  listLiveEmbodiedSessions,
  spawnEmbodiedAgentInVW,
  _resetSpawnEmbodiedAgentInVWForTesting,
} from '../src/agent/spawn-embodied-agent-in-vw.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  resetForTesting as resetPtyRegistry,
  setPtyAdapterForTesting,
} from '../src/pty-shell/registry.js';

function makeTestRegistry() {
  const book = createAddressBook();
  const coord = new DisplayCoordinator({ frameMs: 0 });
  return new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
}

function installFakePty() {
  setPtyAdapterForTesting(() => ({
    pid: 1111,
    write() {},
    kill() {},
    onData(_cb: (data: string) => void) {
      return { dispose() { /* noop */ } };
    },
    onExit(_cb: (e: { exitCode: number; signal?: number }) => void) {
      return { dispose() { /* noop */ } };
    },
  }));
}

afterEach(() => {
  _resetSpawnEmbodiedAgentInVWForTesting();
  resetPtyRegistry();
  setPtyAdapterForTesting(null);
});

describe('spawnEmbodiedAgentInVW', () => {
  test('throws when not wired', async () => {
    let err: unknown;
    try {
      await spawnEmbodiedAgentInVW({ brand: 'codex' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/not wired/);
  });

  test('launches codex via bus · produces window + pane + pty', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({
      brand: 'codex',
      mode: 'pty-direct',
      cwd: '/tmp',
    });
    expect(r.windowId).toBeGreaterThan(0);
    expect(r.paneId).toBeTruthy();
    expect(r.ptyId).toBeTruthy();
    expect(r.session.transports.some((t) => t.kind === 'pty')).toBe(true);
    expect(r.session.transports[0]!.id).toBe(r.ptyId);
    await r.session.dispose();
  });

  test('codex hybrid attaches rpc transport when available', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({
      brand: 'codex',
      cwd: '/tmp',
      _hybridDeps: {
        acquireCodexRpcTransport: async () => ({ kind: 'rpc', id: 'cas-1', label: 'codex-app-server' }),
      },
    });
    expect(r.session.transports.map((t) => t.kind)).toEqual(['pty', 'rpc']);
    expect(r.session.transports[1]?.id).toBe('cas-1');
    await r.session.dispose();
  });

  test('codex hybrid degrades to pty when rpc attach fails', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({
      brand: 'codex',
      cwd: '/tmp',
      _hybridDeps: {
        acquireCodexRpcTransport: async () => { throw new Error('boom'); },
      },
    });
    expect(r.session.transports.map((t) => t.kind)).toEqual(['pty']);
    await r.session.dispose();
  });

  test('uses supplied title · falls back to brand + cwd basename', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({
      brand: 'codex',
      cwd: '/tmp',
      title: 'my-cxn',
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('my-cxn');
    await r.session.dispose();
  });

  test('default title uses brand + basename(cwd)', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({
      brand: 'codex',
      cwd: '/tmp',
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('codex [tmp]');
    await r.session.dispose();
  });

  test('unsupported brand surfaces adapter registry error', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    let err: unknown;
    try {
      // H5 P3 registered codex/claude/gemini — use a brand no adapter
      // handles so the registry error path surfaces.
      await spawnEmbodiedAgentInVW({ brand: 'nonexistent-brand' });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/No adapter/);
  });
});

describe('live embodied session registry (H5 P2 bootstrap bridge)', () => {
  test('spawn registers session · findLiveSessionById / ByPaneId return it', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({ brand: 'codex', cwd: '/tmp' });
    expect(listLiveEmbodiedSessions().map((e) => e.session.id)).toContain(r.session.id);
    const byId = findLiveSessionById(r.session.id);
    expect(byId).toBeDefined();
    expect(byId!.paneId).toBe(r.paneId);
    expect(byId!.windowId).toBe(r.windowId);
    const byPane = findLiveSessionByPaneId(r.paneId);
    expect(byPane).toBeDefined();
    expect(byPane!.session.id).toBe(r.session.id);
    await r.session.dispose();
  });

  test('dispose prunes the registry', async () => {
    installFakePty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnEmbodiedAgentInVW({ brand: 'codex', cwd: '/tmp' });
    expect(findLiveSessionById(r.session.id)).toBeDefined();
    await r.session.dispose();
    expect(findLiveSessionById(r.session.id)).toBeUndefined();
    expect(findLiveSessionByPaneId(r.paneId)).toBeUndefined();
  });

  test('unknown id / pane returns undefined', () => {
    expect(findLiveSessionById('nope')).toBeUndefined();
    expect(findLiveSessionByPaneId('nope')).toBeUndefined();
  });
});
