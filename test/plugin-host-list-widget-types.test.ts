// ── PC-INTRO (Bundle 3) — PluginContext.listWidgetTypes() integration ──
//
// Verifies the PluginContext path of the widget-host introspection API.
// Slash command handlers / LLM tool dispatchers / event handlers all
// share the same PluginContext shape; testing the slash path proves
// the API works for the most common consumer.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PluginHost, type HostHooks } from '../src/plugins/core/host.js';
import { WidgetHost } from '../src/widgets/host.js';
import type { WidgetTypeInfo } from '../src/widgets/types.js';

function makeHooks(): HostHooks {
  return {
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
  };
}

function writePlugin(dir: string, name: string, body: string): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.ts'), body);
}

describe('PluginContext.listWidgetTypes', () => {
  let root: string;
  let builtinDir: string;
  let userDir: string;
  let host: PluginHost;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elanous-pcintro-'));
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

  test('plugin sees registered widget types via ctx.listWidgetTypes()', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({
      type: 'sparkline', description: 'small line chart',
      defaultCharacter: 'Spark',
      initialState: () => ({}), render: () => [],
    });
    widgetHost.register({
      type: 'fader', description: 'fade in/out indicator',
      initialState: () => ({}), render: () => [],
    });
    host.setWidgetHost(widgetHost);

    let captured: readonly WidgetTypeInfo[] | undefined;
    writePlugin(builtinDir, 'introspect', `
      export default {
        name: 'introspect', version: '0', description: '',
        initialState: () => ({}), panes: {},
        slashCommands: [{
          name: 'list-types',
          handler: async (_args, ctx) => { (globalThis as any).__captured = ctx.listWidgetTypes?.(); },
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('introspect');
    await host.dispatchSlash('list-types', []);
    captured = (globalThis as any).__captured;
    delete (globalThis as any).__captured;

    expect(captured).toBeDefined();
    const types = (captured ?? []).map(t => t.type).sort();
    expect(types).toEqual(['fader', 'sparkline']);
    const sparkline = captured!.find(t => t.type === 'sparkline')!;
    expect(sparkline.description).toBe('small line chart');
    expect(sparkline.defaultCharacter).toBe('Spark');
    expect(sparkline.source).toBe('builtin');
  });

  test('listWidgetTypes is undefined when no widget-host is wired', async () => {
    // No setWidgetHost() — older shells.
    let value: unknown = 'sentinel';
    writePlugin(builtinDir, 'no-host', `
      export default {
        name: 'no-host', version: '0', description: '',
        initialState: () => ({}), panes: {},
        slashCommands: [{
          name: 'check',
          handler: async (_args, ctx) => { (globalThis as any).__seen = ctx.listWidgetTypes; },
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('no-host');
    await host.dispatchSlash('check', []);
    value = (globalThis as any).__seen;
    delete (globalThis as any).__seen;
    expect(value).toBeUndefined();
  });

  test('plugin-contributed widgets show up with source="plugin"', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({
      type: 'builtin-w', description: 'builtin',
      initialState: () => ({}), render: () => [],
    }, 'builtin');
    host.setWidgetHost(widgetHost);

    writePlugin(builtinDir, 'has-widget', `
      export default {
        name: 'has-widget', version: '0', description: '',
        initialState: () => ({}), panes: {},
        widgets: [{
          type: 'plugin-w', description: 'from plugin',
          initialState: () => ({}), render: () => [],
        }],
        slashCommands: [{
          name: 'snapshot',
          handler: async (_args, ctx) => { (globalThis as any).__snap = ctx.listWidgetTypes?.(); },
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('has-widget');
    await host.dispatchSlash('snapshot', []);
    const snap = (globalThis as any).__snap as WidgetTypeInfo[];
    delete (globalThis as any).__snap;

    const sources = new Map(snap.map(t => [t.type, t.source]));
    expect(sources.get('builtin-w')).toBe('builtin');
    expect(sources.get('plugin-w')).toBe('plugin');
  });
});
