// ── PluginHost × MSS M1.2 narrow tests ──
//
// Verifies that PluginHost.activate() mints a fresh PluginUri per
// activation cycle and surfaces it on the ActivePlugin record.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { PluginHost, type HostHooks } from '../src/plugins/core/host.ts';
import { asPluginUri } from '../src/mss/uri/builder.ts';

function makeHooks(): HostHooks {
  return {
    log: () => { /* no-op */ },
    hudSet: () => { /* no-op */ },
    requestRender: () => { /* no-op */ },
    focusPane: () => { /* no-op */ },
  };
}

function writePlugin(dir: string, name: string, body: string): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.ts'), body);
}

const TRIVIAL_PLUGIN_BODY = `
  export default {
    name: 'mss-narrow-demo', version: '0', description: '',
    initialState: () => ({}),
    panes: {},
  };
`;

describe('PluginHost × MSS M1.2 PluginUri narrow', () => {
  let root: string;
  let builtinDir: string;
  let userDir: string;
  let host: PluginHost;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mss-m1_2-plugin-'));
    process.env.XDG_DATA_HOME = join(root, 'data');
    builtinDir = join(root, 'plugins');
    userDir = join(root, 'user-plugins');
    mkdirSync(builtinDir);
    mkdirSync(userDir);
    host = new PluginHost(makeHooks());
    (host as any).scanOverride = { builtin: builtinDir, user: userDir };
  });

  afterEach(() => {
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
    rmSync(root, { recursive: true, force: true });
  });

  test('activate() stamps a valid PluginUri on the ActivePlugin record', async () => {
    writePlugin(builtinDir, 'mss-narrow-demo', TRIVIAL_PLUGIN_BODY);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('mss-narrow-demo');

    const active = host.active();
    expect(active).not.toBeNull();
    expect(active!.pluginUri).toBeDefined();
    expect(() => asPluginUri(active!.pluginUri)).not.toThrow();
    // Per-activation URI follows the canonical Tier 2 shape.
    expect(active!.pluginUri).toMatch(/^plugin\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('reactivating the same plugin mints a fresh PluginUri', async () => {
    writePlugin(builtinDir, 'mss-narrow-demo', TRIVIAL_PLUGIN_BODY);
    await (host as any).scanDir(builtinDir, 'builtin');

    await host.activate('mss-narrow-demo');
    const firstUri = host.active()!.pluginUri;

    await host.deactivate();
    await host.activate('mss-narrow-demo');
    const secondUri = host.active()!.pluginUri;

    expect(secondUri).not.toBe(firstUri);
  });
});
