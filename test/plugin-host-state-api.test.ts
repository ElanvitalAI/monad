// ── PX-2 P4: plugin-host → ctx.persistentState wiring ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginHost, type HostHooks } from '../src/plugins/core/host';
import { FsPluginStatePersistence } from '../src/plugin-state/persistence';
import type { PluginContext } from '../src/plugins/core/types';

function makeHooks(): HostHooks & {
  logs: string[];
  hud: Record<string, { value: string; priority?: number }>;
} {
  const logs: string[] = [];
  const hud: Record<string, { value: string; priority?: number }> = {};
  return {
    logs, hud,
    log: (l) => logs.push(l),
    hudSet: (k, v) => { if (v) hud[k] = { value: v }; else delete hud[k]; },
    requestRender: () => {},
    focusPane: () => {},
  };
}

function writePluginFile(dir: string, id: string, capture: (ctx: PluginContext) => void): void {
  mkdirSync(join(dir, id), { recursive: true });
  (globalThis as any)[`__capture_${id}`] = capture;
  writeFileSync(
    join(dir, id, 'plugin.ts'),
    `
    export default {
      name: 'plugin-state-test-${id}',
      version: '0.0.1',
      description: 'probe',
      initialState: () => ({}),
      panes: {},
      onActivate: (ctx) => { (globalThis as any).__capture_${id}(ctx); },
    };
    `,
    'utf-8',
  );
}

describe('plugin-host + persistentState', () => {
  let root: string;
  let builtinDir: string;
  let userRoot: string;
  let host: PluginHost;
  let persistence: FsPluginStatePersistence;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'psh-'));
    builtinDir = join(root, 'plugins');
    mkdirSync(builtinDir);
    userRoot = join(root, 'state-user');
    persistence = new FsPluginStatePersistence({ userRoot, warn: () => {} });
    host = new PluginHost(makeHooks(), null, { statePersistence: persistence });
    (host as any).scanOverride = { builtin: builtinDir, user: '/nonexistent' };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('ctx.persistentState is populated on activate', async () => {
    let captured: PluginContext | null = null;
    writePluginFile(builtinDir, 'alpha', (ctx) => { captured = ctx; });
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('alpha');
    expect(captured).not.toBeNull();
    const ps = captured!.persistentState;
    expect(ps).toBeDefined();
    // Round-trip through the API.
    await ps!.persist('k', { v: 1 });
    expect(await ps!.load('k')).toEqual({ v: 1 });
  });

  test('different plugins see namespaced state (cannot read each other)', async () => {
    let alphaCtx: PluginContext | null = null;
    writePluginFile(builtinDir, 'alpha', (ctx) => { alphaCtx = ctx; });
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('alpha');
    await alphaCtx!.persistentState!.persist('secret', { v: 'alpha-only' });
    await host.deactivate();

    let betaCtx: PluginContext | null = null;
    writePluginFile(builtinDir, 'beta', (ctx) => { betaCtx = ctx; });
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('beta');
    // Beta sees no 'secret' key in its own namespace.
    expect(await betaCtx!.persistentState!.load('secret')).toBeNull();
  });

  test('deactivate clears session state for that plugin only', async () => {
    let alphaCtx: PluginContext | null = null;
    writePluginFile(builtinDir, 'alpha', (ctx) => { alphaCtx = ctx; });
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('alpha');
    const sess = alphaCtx!.persistentState!.session<number>('counter');
    sess.write(42);
    expect(sess.read()).toBe(42);
    await host.deactivate();

    // Reactivate — session state is cleared (new handle, value=null).
    await host.activate('alpha');
    const sess2 = alphaCtx!.persistentState!.session<number>('counter');
    // NOTE: this uses the prior ctx reference — but the plugin-host
    // rebuilds the API on first property access each activation
    // cycle. The pre-deactivate handle still reads from the cleared
    // map entry. To assert cleanly, we read via the fresh getter.
    expect(sess2.read()).toBeNull();
  });

  test('host without statePersistence yields undefined ctx.persistentState', async () => {
    const bareHost = new PluginHost(makeHooks(), null);
    (bareHost as any).scanOverride = { builtin: builtinDir, user: '/nonexistent' };
    let ctx: PluginContext | null = null;
    writePluginFile(builtinDir, 'alpha', (c) => { ctx = c; });
    await (bareHost as any).scanDir(builtinDir, 'builtin');
    await bareHost.activate('alpha');
    expect(ctx!.persistentState).toBeUndefined();
  });
});
