// ── Plugin host tests — discovery, lifecycle, slash dispatch ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PluginHost, matchesKey, type HostHooks } from '../src/plugins/core/host.js';
import { WidgetHost } from '../src/widgets/host.js';
import { createDisplayEventBus } from '../src/display/index.js';
import type { MonadPlugin } from '../src/plugins/core/types.js';
import type { WidgetDef } from '../src/widgets/types.js';
import type { DisplayHandle } from '../src/display/types.js';
import { getPromptBankStore, resetPromptBankStoreForTests } from '../src/prompt-bank/store.js';

// Minimal hooks that record invocations.
function makeHooks(): HostHooks & {
  logs: string[];
  hud: Record<string, { value: string; priority?: number }>;
  renders: (string | undefined)[];
  focuses: string[];
} {
  const logs: string[] = [];
  const hud: Record<string, { value: string; priority?: number }> = {};
  const renders: (string | undefined)[] = [];
  const focuses: string[] = [];
  return {
    logs, hud, renders, focuses,
    log: (line) => { logs.push(line); },
    hudSet: (k, v, p) => { if (v) hud[k] = { value: v, priority: p }; else delete hud[k]; },
    requestRender: (pane) => { renders.push(pane); },
    focusPane: (pane) => { focuses.push(pane); },
  };
}

// Build a fake plugin module and write it into a temp directory.
function writePlugin(dir: string, name: string, body: string): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.ts'), body);
}

function writePluginManifest(dir: string, name: string, manifest: Record<string, unknown>): void {
  const pluginDir = join(dir, name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2));
}

describe('PluginHost', () => {
  let root: string;
  let builtinDir: string;
  let userDir: string;
  let host: PluginHost;
  let hooks: ReturnType<typeof makeHooks>;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'monad-host-'));
    process.env.XDG_DATA_HOME = join(root, 'data');
    resetPromptBankStoreForTests();
    builtinDir = join(root, 'plugins');
    userDir = join(root, 'user-plugins');
    mkdirSync(builtinDir);
    mkdirSync(userDir);
    hooks = makeHooks();
    host = new PluginHost(hooks);
    // Swap scan dirs via private injection — build the helper below.
    (host as any).scanOverride = { builtin: builtinDir, user: userDir };
  });

  afterEach(() => {
    resetPromptBankStoreForTests();
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
    rmSync(root, { recursive: true, force: true });
  });

  test('plugin without default export is reported and skipped', async () => {
    writePlugin(builtinDir, 'bad', `export const notDefault = {};`);
    // We can't easily reroute BUILTIN_DIR at runtime, so instead we
    // call scanDir directly via any-cast.
    await (host as any).scanDir(builtinDir, 'builtin');
    expect(hooks.logs.some(l => l.includes('no default export'))).toBe(true);
    expect(host.list()).toHaveLength(0);
  });

  test('directory with no plugin.ts and no manifest is silently skipped', async () => {
    // Reproduces the log-spam scenario: directories like
    // plugins/iul-shared (library-only files) or
    // ~/.claude/plugins/{cache,data,marketplaces} (Claude Code internal
    // state) shouldn't warn — they never intended to be plugins.
    const bareDir = join(builtinDir, 'not-a-plugin');
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(join(bareDir, 'index.ts'), 'export const lib = 1;');
    writeFileSync(join(bareDir, 'helper.ts'), 'export const h = 2;');
    await (host as any).scanDir(builtinDir, 'builtin');
    expect(hooks.logs.filter(l => l.includes('main not found'))).toHaveLength(0);
    expect(host.list()).toHaveLength(0);
  });

  test('directory with explicit manifest but missing main still warns', async () => {
    // Regression guard: real misconfiguration (manifest promises a
    // main file that doesn't exist) must keep warning.
    writePluginManifest(builtinDir, 'broken', {
      id: 'broken',
      name: 'Broken',
      version: '1.0.0',
      main: './does-not-exist.ts',
    });
    await (host as any).scanDir(builtinDir, 'builtin');
    expect(hooks.logs.some(l => l.includes('main not found'))).toBe(true);
    expect(host.list()).toHaveLength(0);
  });

  test('valid plugin is discovered and listed', async () => {
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo',
        version: '0.0.1',
        description: 'demo plugin',
        initialState: () => ({ counter: 0 }),
        panes: {},
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    const items = host.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.plugin.name).toBe('demo');
    expect(items[0]?.source).toBe('builtin');
    expect(items[0]?.manifestInferred).toBe(true);
    expect(items[0]?.manifest.id).toBe('demo');
  });

  test('plugin.json controls identity and custom main entry', async () => {
    const pluginDir = join(builtinDir, 'manifested');
    mkdirSync(pluginDir, { recursive: true });
    writePluginManifest(builtinDir, 'manifested', {
      id: 'demo.manifested',
      name: 'Manifested Demo',
      version: '2.0.0',
      main: './entry.ts',
      activationEvents: ['onCommand:demo.hello'],
      contributes: {
        commands: [{ name: 'demo.hello', description: 'Hello' }],
      },
    });
    writeFileSync(join(pluginDir, 'entry.ts'), `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [{ name: 'demo.hello', description: '', handler: (_a, ctx) => ctx.log('hello') }],
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    const item = host.list()[0]!;
    expect(item.manifestInferred).toBe(false);
    expect(item.manifest.id).toBe('demo.manifested');
    expect(item.plugin.name).toBe('Manifested Demo');
    expect(item.plugin.version).toBe('2.0.0');

    await host.activate('demo.manifested');
    expect(host.isActive('demo.manifested')).toBe(true);
    await host.dispatchSlash('demo.hello', []);
    expect(hooks.logs).toContain('hello');
  });

  test('plugin context exposes current theme tokens', async () => {
    hooks.theme = () => ({
      name: 'host-test',
      colors: {
        text: '#000001',
        muted: '#000002',
        dim: '#000003',
        accent: '#445566',
        success: '#000004',
        warning: '#000005',
        error: '#000006',
        info: '#000007',
        highlight: '#000008',
      },
      pane: {
        titleActive: '#000009',
        titleInactive: '#00000a',
        dividerActive: '#00000b',
        dividerInactive: '#00000c',
      },
      modal: {
        borderActive: '#00000d',
        borderInactive: '#00000e',
        title: '#00000f',
      },
      cursor: {
        focused: '#000010',
        inactive: '#000011',
      },
      widget: {
        accent: '#000012',
        selected: '#000013',
      },
    });
    writePlugin(builtinDir, 'theme-aware', `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [{
          name: 'theme.probe',
          description: '',
          handler: (_args, ctx) => ctx.log(ctx.theme.current().colors.accent),
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('theme-aware');
    await host.dispatchSlash('theme.probe', []);
    expect(hooks.logs).toContain('#445566');
  });

  test('plugin.json dependencies.widgets are enforced at activation', async () => {
    writePluginManifest(builtinDir, 'needs-table', {
      id: 'needs-table',
      name: 'Needs Table',
      version: '1.0.0',
      main: './plugin.ts',
      dependencies: { widgets: ['table'] },
    });
    writePlugin(builtinDir, 'needs-table', `
      export default { initialState: () => ({}), panes: {} };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await expect(host.activate('needs-table')).rejects.toThrow(/widget registry|requires widget type/);

    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({ type: 'table', description: '', initialState: () => ({}), render: () => [] });
    host.setWidgetHost(widgetHost);
    await host.activate('needs-table');
    expect(host.isActive('needs-table')).toBe(true);
  });

  test('invalid plugin.json is reported and skipped', async () => {
    writePluginManifest(builtinDir, 'bad-manifest', {
      id: '../bad',
      main: './plugin.ts',
    });
    writePlugin(builtinDir, 'bad-manifest', `
      export default { name: 'bad-manifest', version: '0', description: '', initialState: () => ({}), panes: {} };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');

    expect(host.list()).toHaveLength(0);
    expect(hooks.logs.some(l => l.includes('failed to load plugin manifest'))).toBe(true);
  });

  test('user plugin overrides built-in with same name (warning logged)', async () => {
    writePlugin(builtinDir, 'demo', `
      export default { name: 'demo', version: '1.0.0', description: 'built-in',
        initialState: () => ({}), panes: {} };
    `);
    writePlugin(userDir, 'demo', `
      export default { name: 'demo', version: '2.0.0', description: 'user',
        initialState: () => ({}), panes: {} };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await (host as any).scanDir(userDir, 'user');
    const items = host.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('user');
    expect(items[0]?.plugin.version).toBe('2.0.0');
    expect(hooks.logs.some(l => l.includes('overrides'))).toBe(true);
  });

  test('activate / deactivate lifecycle runs onActivate and onDeactivate', async () => {
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo',
        version: '0.0.1',
        description: '',
        initialState: () => ({ count: 0 }),
        panes: {},
        onActivate: (ctx) => { ctx.log('activated'); ctx.hudSet('mode', 'demo', 10); },
        onDeactivate: (ctx) => { ctx.log('deactivated'); },
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    expect(host.isActive('demo')).toBe(true);
    // onActivate's ctx.hudSet + host's own 'mode' set — host wins with "mode: demo"
    expect(hooks.hud.mode?.value).toBe('mode: demo');
    expect(hooks.logs).toContain('activated');

    await host.deactivate();
    expect(host.isActive('demo')).toBe(false);
    expect(hooks.logs).toContain('deactivated');
    expect(hooks.hud.mode).toBeUndefined();
  });

  test('activate throws on unknown plugin', async () => {
    await expect(host.activate('missing')).rejects.toThrow(/not found/);
  });

  test('dispatchSlash routes to contributed command', async () => {
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          {
            name: 'poke', description: 'test',
            handler: (args, ctx) => { ctx.log('poked:' + args.join(',')); },
          },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    const handled = await host.dispatchSlash('poke', ['a', 'b']);
    expect(handled).toBe(true);
    expect(hooks.logs).toContain('poked:a,b');

    const unhandled = await host.dispatchSlash('nope', []);
    expect(unhandled).toBe(false);
  });

  test('command registry exposes manifest metadata and hidden commands', async () => {
    writePluginManifest(builtinDir, 'commands', {
      id: 'commands',
      name: 'Commands',
      version: '1.0.0',
      contributes: {
        commands: [
          { name: 'visible', description: 'Visible command' },
          { name: 'hidden.run', description: 'Hidden command', aliases: ['hr'], hidden: true },
        ],
      },
    });
    writePlugin(builtinDir, 'commands', `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          { name: 'visible', description: 'runtime visible', handler: (_a, ctx) => ctx.log('visible') },
          { name: 'hidden.run', description: 'runtime hidden', handler: (_a, ctx) => ctx.log('hidden') },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('commands');

    expect(host.contributedCommands().map(c => c.id)).toEqual(['visible']);
    expect(host.contributedCommands({ includeHidden: true }).map(c => c.id)).toEqual(['hidden.run', 'visible']);
    expect(host.contributedSlashCommands()[0]?.description).toBe('Visible command');

    expect(await host.dispatchCommand('hr', [])).toBe(true);
    expect(hooks.logs).toContain('hidden');
  });

  test('dispatchSlash exposes the scoped display handle', async () => {
    const display: DisplayHandle = {
      owner: 'plugin:host',
      publish: () => {},
      requestRender: () => {},
      focus: () => {},
      currentFocus: () => null,
      cycleFocus: () => null,
      registerFocus: () => ({ dispose: () => {} }),
      registerKey: () => ({ dispose: () => {} }),
    };
    hooks.display = display;
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          {
            name: 'whoami', description: 'test',
            handler: (_args, ctx) => { ctx.log(ctx.display.owner); },
          },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    await host.dispatchSlash('whoami', []);
    expect(hooks.logs).toContain('plugin:host');
  });

  test('dispatchSlash exposes focus and keymap display APIs', async () => {
    const keys: string[] = [];
    const focused: string[] = [];
    let disposed = false;
    const display: DisplayHandle = {
      owner: 'plugin:host',
      publish: () => {},
      requestRender: () => {},
      focus: (target) => { focused.push(target); },
      currentFocus: () => 'widget:demo',
      cycleFocus: (_scope, _dir) => 'widget:next',
      registerFocus: () => ({ dispose: () => {} }),
      registerKey: (binding) => {
        keys.push(`${binding.scope}:${binding.key}:${binding.command}`);
        return { dispose: () => { disposed = true; } };
      },
    };
    hooks.display = display;
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          {
            name: 'wire', description: 'test',
            handler: (_args, ctx) => {
              ctx.log('focus:' + ctx.focus.current());
              ctx.focus.set('widget:demo');
              ctx.log('cycle:' + ctx.focus.cycle('plugin:demo', 1));
              ctx.keymap.register({ key: 'C-r', scope: 'plugin:demo', command: 'demo.refresh' });
            },
          },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    await host.dispatchSlash('wire', []);
    expect(hooks.logs).toContain('focus:widget:demo');
    expect(hooks.logs).toContain('cycle:widget:next');
    expect(focused).toEqual(['widget:demo']);
    expect(keys).toEqual(['plugin:demo:C-r:demo.refresh']);
    await host.deactivate();
    expect(disposed).toBe(true);
  });

  test('dispatchSlash exposes display event subscriptions', async () => {
    const bus = createDisplayEventBus();
    hooks.displayEvents = bus;
    writePlugin(builtinDir, 'events', `
      export default {
        name: 'events', version: '0', description: '',
        initialState: () => ({ seen: 0 }), panes: {},
        slashCommands: [{ name: 'listen', description: '', handler: (_args, ctx) => {
          ctx.events.subscribe('focus:change', () => ctx.setState({ seen: ctx.state.seen + 1 }));
        } }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('events');
    await host.dispatchSlash('listen', []);

    bus.emit({ type: 'focus:change', previous: null, next: 'pane:x' });
    expect((host.active()?.state as any).seen).toBe(1);
    await host.deactivate();
    bus.emit({ type: 'focus:change', previous: 'pane:x', next: 'pane:y' });
    expect(host.active()).toBeNull();
  });

  test('dispatchSlash exposes execution surface spawn API', async () => {
    const spawned: string[] = [];
    hooks.execution = {
      spawn: (spec) => {
        spawned.push(`${spec.cwd}:${spec.command}`);
        return {
          id: spec.id ?? 'execution:test',
          surface: {
            id: spec.id ?? 'execution:test',
            kind: 'execution',
            owner: 'plugin:demo',
            focus: 'owns',
            priority: 0,
            render: () => [],
          },
          terminal: {
            start: () => {},
            stop: () => {},
            resize: () => {},
            write: () => {},
            render: () => '',
            isAlive: true,
          },
          start: () => {},
          stop: () => {},
          resize: () => {},
          write: () => {},
          render: () => [],
          dispose: () => {},
        };
      },
    };
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          {
            name: 'run', description: 'test',
            handler: async (_args, ctx) => {
              const handle = await ctx.execution.spawn({ cwd: '/tmp', command: 'echo ok' });
              ctx.log(handle.id);
            },
          },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    await host.dispatchSlash('run', []);
    expect(spawned).toEqual(['/tmp:echo ok']);
    expect(hooks.logs).toContain('execution:test');
  });

  test('user plugin execution requires process capability', async () => {
    const spawned: string[] = [];
    hooks.execution = {
      spawn: (spec) => {
        spawned.push(`${spec.cwd}:${spec.command}`);
        return {
          id: 'execution:test',
          surface: { id: 'execution:test', kind: 'execution', owner: 'plugin:demo', focus: 'owns', priority: 0, render: () => [] },
          terminal: { start: () => {}, stop: () => {}, resize: () => {}, write: () => {}, render: () => '', isAlive: true },
          start: () => {},
          stop: () => {},
          resize: () => {},
          write: () => {},
          render: () => [],
          dispose: () => {},
        };
      },
    };
    writePlugin(userDir, 'user-runner', `
      export default {
        name: 'user-runner', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          { name: 'run', description: 'test', handler: async (_args, ctx) => {
            await ctx.execution.spawn({ cwd: '/tmp', command: 'echo ok' });
          } },
        ],
      };
    `);

    await (host as any).scanDir(userDir, 'user');
    await host.activate('user-runner');

    await expect(host.dispatchSlash('run', [])).rejects.toThrow(/process execution requires capability/);
    expect(spawned).toEqual([]);
  });

  test('user plugin process capability allows matching command only', async () => {
    const spawned: string[] = [];
    hooks.execution = {
      spawn: (spec) => {
        spawned.push(`${spec.cwd}:${spec.command}`);
        return {
          id: 'execution:test',
          surface: { id: 'execution:test', kind: 'execution', owner: 'plugin:demo', focus: 'owns', priority: 0, render: () => [] },
          terminal: { start: () => {}, stop: () => {}, resize: () => {}, write: () => {}, render: () => '', isAlive: true },
          start: () => {},
          stop: () => {},
          resize: () => {},
          write: () => {},
          render: () => [],
          dispose: () => {},
        };
      },
    };
    writePluginManifest(userDir, 'user-runner', {
      id: 'user-runner',
      name: 'User Runner',
      version: '1.0.0',
      capabilities: [{ kind: 'process:spawn', commands: ['echo'] }],
    });
    writePlugin(userDir, 'user-runner', `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          { name: 'echo', description: 'test', handler: async (_args, ctx) => {
            await ctx.execution.spawn({ cwd: '/tmp', command: 'echo ok' });
          } },
          { name: 'python', description: 'test', handler: async (_args, ctx) => {
            await ctx.execution.spawn({ cwd: '/tmp', command: 'python3 -V' });
          } },
        ],
      };
    `);

    await (host as any).scanDir(userDir, 'user');
    await host.activate('user-runner');

    expect(await host.dispatchSlash('echo', [])).toBe(true);
    await expect(host.dispatchSlash('python', [])).rejects.toThrow(/python3/);
    expect(spawned).toEqual(['/tmp:echo ok']);
  });

  test('ctx.tasks.run executes manifest task through capability-checked execution', async () => {
    const started: string[] = [];
    hooks.execution = {
      spawn: (spec) => ({
        id: spec.id ?? 'execution:test',
        surface: { id: spec.id ?? 'execution:test', kind: 'execution', owner: 'plugin:demo', focus: 'owns', priority: 0, render: () => [] },
        terminal: { start: () => {}, stop: () => {}, resize: () => {}, write: () => {}, render: () => '', isAlive: false },
        start: () => { started.push(`${spec.cwd}:${spec.command}`); },
        stop: () => {},
        resize: () => {},
        write: () => {},
        render: () => [],
        dispose: () => {},
      }),
    };
    writePluginManifest(userDir, 'task-runner', {
      id: 'task-runner',
      name: 'Task Runner',
      version: '1.0.0',
      capabilities: [{ kind: 'process:spawn', commands: ['echo'] }],
      contributes: {
        tasks: [{ id: 'say', label: 'Say', command: 'echo', args: ['hello'], cwd: '/tmp' }],
      },
    });
    writePlugin(userDir, 'task-runner', `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          { name: 'say', description: 'test', handler: async (_args, ctx) => {
            ctx.log('tasks:' + ctx.tasks.list().map(t => t.id).join(','));
            const handle = await ctx.tasks.run('say');
            ctx.log(handle.id);
          } },
        ],
      };
    `);

    await (host as any).scanDir(userDir, 'user');
    await host.activate('task-runner');

    expect(await host.dispatchSlash('say', [])).toBe(true);
    expect(hooks.logs).toContain('tasks:say');
    expect(hooks.logs).toContain('execution:task-runner:say');
    expect(started).toEqual(['/tmp:echo hello']);
  });

  test('routeKey: passthrough when no plugin active', async () => {
    const res = await host.routeKey({ name: 'j' }, 'log');
    expect(res).toBe('passthrough');
  });

  test('routeKey: consumed when plugin reports busy, skips keybindings', async () => {
    writePlugin(builtinDir, 'busy-plug', `
      export default {
        name: 'busy-plug', version: '0', description: '',
        initialState: () => ({ busy: true }),
        panes: {},
        isBusy: (s) => s.busy,
        keybindings: [{ key: 'r', command: 'reset' }],
        slashCommands: [{ name: 'reset', description: '',
          handler: (_a, ctx) => { ctx.log('should-not-fire'); } }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('busy-plug');
    const res = await host.routeKey({ name: 'r' }, 'log');
    expect(res).toBe('consumed');
    expect(hooks.logs).not.toContain('should-not-fire');
  });

  test('routeKey: keybinding dispatches the bound slash command', async () => {
    writePlugin(builtinDir, 'kb', `
      export default {
        name: 'kb', version: '0', description: '',
        initialState: () => ({ busy: false }),
        panes: {},
        isBusy: (s) => s.busy,
        keybindings: [{ key: 'r', command: 'run' }],
        slashCommands: [{ name: 'run', description: '',
          handler: (_a, ctx) => { ctx.log('ran'); } }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('kb');
    const res = await host.routeKey({ name: 'r' }, 'log');
    expect(res).toBe('consumed');
    expect(hooks.logs).toContain('ran');
  });

  test('routeKey: falls through to plugin.onKey when keybindings miss', async () => {
    writePlugin(builtinDir, 'onkey', `
      export default {
        name: 'onkey', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        onKey: (ev) => ev.name === 'x' ? ({ type: 'refresh' }) : ({ type: 'none' }),
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('onkey');
    const rendersBefore = hooks.renders.length;
    const hit = await host.routeKey({ name: 'x' }, 'log');
    const miss = await host.routeKey({ name: 'z' }, 'log');
    expect(hit).toBe('consumed');
    expect(miss).toBe('passthrough');
    expect(hooks.renders.length).toBeGreaterThan(rendersBefore);
  });

  test('routeKey: runSlash hook overrides host.dispatchSlash when provided', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const h = makeHooks();
    h.runSlash = (cmd, args) => { calls.push({ cmd, args: [...args] }); };
    const h2 = new PluginHost(h);
    writePlugin(builtinDir, 'rs', `
      export default {
        name: 'rs', version: '0', description: '',
        initialState: () => ({}), panes: {},
        keybindings: [{ key: 'a', command: 'act one two' }],
        slashCommands: [{ name: 'act', description: '',
          handler: () => { /* should not fire when runSlash hook set */ } }],
      };
    `);
    await (h2 as any).scanDir(builtinDir, 'builtin');
    await h2.activate('rs');
    await h2.routeKey({ name: 'a' }, 'log');
    expect(calls).toEqual([{ cmd: 'act', args: ['one', 'two'] }]);
  });

  test('plugin context exposes capability-checked fs wrappers', async () => {
    const allowed = join(root, 'allowed.txt');
    const blocked = join(root, 'blocked.txt');
    writeFileSync(allowed, 'ok');
    writeFileSync(blocked, 'no');
    writePluginManifest(userDir, 'cap', {
      id: 'cap',
      name: 'cap',
      version: '0',
      main: './plugin.ts',
      capabilities: [{ kind: 'fs:read', roots: [allowed] }],
    });
    writePlugin(userDir, 'cap', `
      export default {
        name: 'cap', version: '0', description: '',
        initialState: () => ({}), panes: {},
        slashCommands: [{ name: 'check', description: '',
          handler: (_args, ctx) => {
            ctx.log(String(ctx.capabilities.canReadFile(${JSON.stringify(allowed)})));
            ctx.log(ctx.capabilities.readTextFile(${JSON.stringify(allowed)}));
            ctx.log(String(ctx.capabilities.canReadFile(${JSON.stringify(blocked)})));
          } }],
      };
    `);
    await (host as any).scanDir(userDir, 'user');
    await host.activate('cap');
    await host.dispatchSlash('check', []);
    expect(hooks.logs.slice(-3)).toEqual(['true', 'ok', 'false']);
  });

  test('activate rejects plugin with missing requiredWidgets', async () => {
    writePlugin(builtinDir, 'needs-widget', `
      export default {
        name: 'needs-widget', version: '0', description: '',
        initialState: () => ({}), panes: {},
        requiredWidgets: ['chart-line'],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    // No widget host attached → activation fails
    await expect(host.activate('needs-widget')).rejects.toThrow(/no widget registry|not installed/);
  });

  test('activate passes when requiredWidgets all present', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    const fakeWidget: WidgetDef = {
      type: 'chart-line', description: '',
      initialState: () => ({}),
      render: () => [],
    };
    widgetHost.register(fakeWidget);
    host.setWidgetHost(widgetHost);

    writePlugin(builtinDir, 'ok-deps', `
      export default {
        name: 'ok-deps', version: '0', description: '',
        initialState: () => ({}), panes: {},
        requiredWidgets: ['chart-line'],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('ok-deps');
    expect(host.isActive('ok-deps')).toBe(true);
  });

  test('buildLayout result is stored + accessible via activeLayout()', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({
      type: 'fake', description: '',
      initialState: () => ({}), render: () => [],
    });
    host.setWidgetHost(widgetHost);

    writePlugin(builtinDir, 'has-layout', `
      export default {
        name: 'has-layout', version: '0', description: '',
        initialState: () => ({}), panes: {},
        requiredWidgets: ['fake'],
        buildLayout: (ctx) => {
          const w = ctx.spawnWidget({ type: 'fake', id: 'mine' });
          return { rows: [{ cells: [{ widgetInstanceId: w.id }] }], modals: [] };
        },
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('has-layout');
    const layout = host.activeLayout();
    expect(layout).not.toBeNull();
    expect(layout!.rows[0]!.cells[0]!.widgetInstanceId).toBe('mine');
    expect(widgetHost.get('mine')).not.toBeNull();
  });

  test('manifest widget contributions are loaded before buildLayout', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    host.setWidgetHost(widgetHost);
    const pluginDir = join(builtinDir, 'widget-plugin');
    mkdirSync(join(pluginDir, 'widgets'), { recursive: true });
    writePluginManifest(builtinDir, 'widget-plugin', {
      id: 'widget-plugin',
      name: 'Widget Plugin',
      version: '1.0.0',
      contributes: {
        widgets: [{ type: 'widget-plugin.note', entry: './widgets/note.ts' }],
      },
    });
    writeFileSync(join(pluginDir, 'widgets', 'note.ts'), `
      export default {
        type: 'widget-plugin.note',
        description: 'note',
        initialState: (config) => ({ text: config?.text ?? '' }),
        render: (state) => [state.text],
      };
    `);
    writePlugin(builtinDir, 'widget-plugin', `
      export default {
        initialState: () => ({}),
        panes: {},
        buildLayout: (ctx) => {
          const w = ctx.spawnWidget({ type: 'widget-plugin.note', id: 'note', config: { text: 'hello' } });
          return { rows: [{ cells: [{ widgetInstanceId: w.id }] }], modals: [] };
        },
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('widget-plugin');

    expect(widgetHost.hasType('widget-plugin.note')).toBe(true);
    expect(widgetHost.get('note')).not.toBeNull();
    await host.deactivate();
    expect(widgetHost.hasType('widget-plugin.note')).toBe(false);
  });

  test('Arc P5: programmatic plugin.widgets field registers on activate + unregisters on deactivate', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    host.setWidgetHost(widgetHost);
    writePlugin(builtinDir, 'p5-programmatic', `
      export default {
        name: 'p5-programmatic', version: '0', description: '',
        initialState: () => ({}), panes: {},
        widgets: [{
          type: 'p5-custom-one',
          description: 'programmatic widget #1',
          initialState: () => ({ a: 1 }),
          render: () => ['one'],
        }, {
          type: 'p5-custom-two',
          description: 'programmatic widget #2',
          initialState: () => ({ b: 2 }),
          render: () => ['two'],
        }],
      };
    `);

    expect(widgetHost.hasType('p5-custom-one')).toBe(false);
    expect(widgetHost.hasType('p5-custom-two')).toBe(false);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('p5-programmatic');

    expect(widgetHost.hasType('p5-custom-one')).toBe(true);
    expect(widgetHost.hasType('p5-custom-two')).toBe(true);

    await host.deactivate();

    expect(widgetHost.hasType('p5-custom-one')).toBe(false);
    expect(widgetHost.hasType('p5-custom-two')).toBe(false);
  });

  test('Arc P5: plugin.widgets satisfies requiredWidgets (self-contribution)', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    host.setWidgetHost(widgetHost);
    writePlugin(builtinDir, 'p5-self-contained', `
      export default {
        name: 'p5-self-contained', version: '0', description: '',
        initialState: () => ({}), panes: {},
        requiredWidgets: ['p5-self-widget'],
        widgets: [{
          type: 'p5-self-widget',
          description: 'plugin-supplied dep',
          initialState: () => ({}),
          render: () => ['self'],
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    // Should activate cleanly — the plugin ships its own required widget.
    await host.activate('p5-self-contained');
    expect(host.isActive('p5-self-contained')).toBe(true);
    expect(widgetHost.hasType('p5-self-widget')).toBe(true);
  });

  test('Arc P5: activate without widgetHost throws when plugin.widgets is set', async () => {
    // Host has no widget registry attached.
    writePlugin(builtinDir, 'p5-no-host', `
      export default {
        name: 'p5-no-host', version: '0', description: '',
        initialState: () => ({}), panes: {},
        widgets: [{
          type: 'p5-orphan',
          description: 'orphan',
          initialState: () => ({}),
          render: () => [],
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await expect(host.activate('p5-no-host')).rejects.toThrow(/no widget registry/);
  });

  test('manifest pane and view contributions are exposed while active', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({
      type: 'note',
      description: 'note',
      initialState: (config) => ({ text: config?.text ?? '' }),
      render: (state: any) => [state.text],
    });
    host.setWidgetHost(widgetHost);
    writePluginManifest(builtinDir, 'dashboard-plugin', {
      id: 'dashboard-plugin',
      name: 'Dashboard Plugin',
      version: '1.0.0',
      contributes: {
        panes: [{ id: 'status', widget: 'note', title: 'Status', config: { text: 'ready' } }],
        views: [{
          id: 'monitor',
          label: 'Monitor',
          shortcut: '5',
          primary: 'status',
          rows: [{ panes: ['status', 'log'] }],
        }],
      },
    });
    writePlugin(builtinDir, 'dashboard-plugin', `
      export default {
        initialState: () => ({}),
        panes: {},
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('dashboard-plugin');

    expect(host.activeDashboardPanes()).toEqual([expect.objectContaining({
      paneId: 'plugin:dashboard-plugin.status',
      widgetInstanceId: 'plugin-pane:plugin:dashboard-plugin.status',
      title: 'Status',
    })]);
    expect(widgetHost.get('plugin-pane:plugin:dashboard-plugin.status')?.state).toEqual({ text: 'ready' });
    expect(host.activeDashboardViews()[0]).toMatchObject({
      id: 'plugin:dashboard-plugin.monitor',
      primary: 'plugin:dashboard-plugin.status',
      rows: [{ panes: ['plugin:dashboard-plugin.status', 'log'] }],
    });

    await host.deactivate();
    expect(host.activeDashboardPanes()).toEqual([]);
    expect(host.activeDashboardViews()).toEqual([]);
    expect(widgetHost.get('plugin-pane:plugin:dashboard-plugin.status')).toBeNull();
  });

  test('manifest theme contributions are exposed and loaded with cache', async () => {
    const pluginDir = join(builtinDir, 'theme-plugin');
    mkdirSync(join(pluginDir, 'themes'), { recursive: true });
    writePluginManifest(builtinDir, 'theme-plugin', {
      id: 'theme-plugin',
      name: 'Theme Plugin',
      version: '1.0.0',
      contributes: {
        themes: [{ id: 'ocean', label: 'Ocean', path: './themes/ocean.json' }],
      },
    });
    writeFileSync(join(pluginDir, 'themes', 'ocean.json'), JSON.stringify({
      name: 'ocean',
      colors: { accent: '#123abc' },
    }));
    writePlugin(builtinDir, 'theme-plugin', `
      export default {
        initialState: () => ({}),
        panes: {},
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('theme-plugin');

    expect(host.activeThemeContributions()).toEqual([expect.objectContaining({
      id: 'plugin:theme-plugin.ocean',
      localId: 'ocean',
      label: 'Ocean',
    })]);
    expect(host.loadThemeTokens('plugin:theme-plugin.ocean')?.colors?.accent).toBe('#123abc');
    expect(host.loadThemeTokens('ocean')?.name).toBe('ocean');
  });

  test('manifest prompt contributions sync into Prompt Bank on activation', async () => {
    const pluginDir = join(builtinDir, 'prompt-plugin');
    mkdirSync(join(pluginDir, 'prompts'), { recursive: true });
    writePluginManifest(builtinDir, 'prompt-plugin', {
      id: 'prompt-plugin',
      name: 'Prompt Plugin',
      version: '1.0.0',
      contributes: {
        prompts: [{
          id: 'context',
          name: 'Prompt Plugin Context',
          path: './prompts/context.md',
          targetSlot: 'context',
          tags: ['plugin-test'],
          triggers: { view: 'debug' },
        }],
      },
    });
    writeFileSync(join(pluginDir, 'prompts', 'context.md'), 'Use the prompt plugin context.');
    writePlugin(builtinDir, 'prompt-plugin', `
      export default {
        initialState: () => ({}),
        panes: {},
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('prompt-plugin');

    const fragment = getPromptBankStore().get('plugin:prompt-plugin.context');
    expect(fragment).toMatchObject({
      id: 'plugin:prompt-plugin.context',
      owner: 'plugin:prompt-plugin',
      scope: 'plugin',
      targetSlot: 'context',
      content: 'Use the prompt plugin context.',
      tags: ['plugin-test'],
      triggers: { view: 'debug', pluginActive: 'prompt-plugin' },
    });
  });

  test('ctx.prompts registers runtime fragments scoped to the active plugin', async () => {
    writePlugin(builtinDir, 'runtime-prompts', `
      export default {
        initialState: () => ({}),
        panes: {},
        onActivate(ctx) {
          ctx.prompts.register({
            id: 'runtime-context',
            name: 'Runtime Context',
            kind: 'instruction',
            targetSlot: 'context',
            content: 'Runtime prompt context.',
            tags: ['runtime'],
          });
          ctx.log(ctx.prompts.describeForLLM());
        },
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('runtime-prompts');

    const fragment = getPromptBankStore().get('plugin:runtime-prompts.runtime-context');
    expect(fragment).toMatchObject({
      owner: 'plugin:runtime-prompts',
      content: 'Runtime prompt context.',
      triggers: { pluginActive: 'runtime-prompts' },
      metadata: expect.objectContaining({ runtime: true }),
    });
    expect(hooks.logs.join('\n')).toContain('plugin:runtime-prompts.runtime-context');
  });

  test('ctx.modals opens and closes manifest-declared widget modals', async () => {
    const renders: Array<string | undefined> = [];
    hooks.requestRender = (pane) => { renders.push(pane); };
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    host.setWidgetHost(widgetHost);
    const pluginDir = join(builtinDir, 'modal-plugin');
    mkdirSync(join(pluginDir, 'widgets'), { recursive: true });
    writePluginManifest(builtinDir, 'modal-plugin', {
      id: 'modal-plugin',
      name: 'Modal Plugin',
      version: '1.0.0',
      contributes: {
        widgets: [{ type: 'modal-plugin.pick', entry: './widgets/pick.ts' }],
        modals: [{ id: 'picker', widget: 'modal-plugin.pick', title: 'Picker', size: { width: 50, height: 10 } }],
      },
    });
    writeFileSync(join(pluginDir, 'widgets', 'pick.ts'), `
      export default {
        type: 'modal-plugin.pick',
        description: 'picker',
        initialState: (config) => ({ label: config?.label ?? 'pick' }),
        render: (state) => [state.label],
      };
    `);
    writePlugin(builtinDir, 'modal-plugin', `
      export default {
        initialState: () => ({}),
        panes: {},
        slashCommands: [
          { name: 'open', description: '', handler: (_args, ctx) => {
            const modal = ctx.modals.open('picker', { config: { label: 'choose' } });
            ctx.log(modal.widgetInstanceId);
          } },
          { name: 'close', description: '', handler: (_args, ctx) => {
            ctx.log('closed:' + ctx.modals.close('picker'));
          } },
        ],
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('modal-plugin');
    await host.dispatchSlash('open', []);

    const layout = host.activeLayout();
    expect(layout?.modals).toHaveLength(1);
    expect(layout?.modals[0]).toMatchObject({ id: 'picker', size: { width: 50, height: 10 } });
    expect(widgetHost.get('modal-plugin:picker')).not.toBeNull();

    await host.dispatchSlash('close', []);
    expect(host.activeLayout()?.modals).toHaveLength(0);
    expect(widgetHost.get('modal-plugin:picker')).toBeNull();
    expect(hooks.logs).toContain('closed:true');
    expect(renders.length).toBeGreaterThanOrEqual(2);
  });

  test('deactivate disposes widgets spawned by buildLayout', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({ type: 'fake', description: '', initialState: () => ({}), render: () => [] });
    host.setWidgetHost(widgetHost);

    writePlugin(builtinDir, 'cleanup', `
      export default {
        name: 'cleanup', version: '0', description: '',
        initialState: () => ({}), panes: {},
        buildLayout: (ctx) => {
          ctx.spawnWidget({ type: 'fake', id: 'a' });
          ctx.spawnWidget({ type: 'fake', id: 'b' });
          return {
            rows: [{ cells: [{ widgetInstanceId: 'a' }, { widgetInstanceId: 'b' }] }],
            modals: [],
          };
        },
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('cleanup');
    expect(widgetHost.instanceCount()).toBe(2);
    await host.deactivate();
    expect(widgetHost.instanceCount()).toBe(0);
    expect(host.activeLayout()).toBeNull();
  });

  test('activate failure cleans up partial widget state', async () => {
    const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
    widgetHost.register({ type: 'fake', description: '', initialState: () => ({}), render: () => [] });
    host.setWidgetHost(widgetHost);

    writePlugin(builtinDir, 'fails', `
      export default {
        name: 'fails', version: '0', description: '',
        initialState: () => ({}), panes: {},
        onActivate: () => { throw new Error('boom'); },
        buildLayout: (ctx) => {
          ctx.spawnWidget({ type: 'fake', id: 'ghost' });
          return { rows: [{ cells: [{ widgetInstanceId: 'ghost' }] }], modals: [] };
        },
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await expect(host.activate('fails')).rejects.toThrow(/boom/);
    expect(host.isActive('fails')).toBe(false);
    // Widget was never spawned because onActivate failed BEFORE buildLayout
    expect(widgetHost.instanceCount()).toBe(0);
  });

  test('matchesKey: parses C-S-A modifiers', () => {
    expect(matchesKey('r', { name: 'r' })).toBe(true);
    expect(matchesKey('r', { name: 'r', shift: true })).toBe(false);
    expect(matchesKey('C-s', { name: 's', ctrl: true })).toBe(true);
    expect(matchesKey('C-S-p', { name: 'p', ctrl: true, shift: true })).toBe(true);
    expect(matchesKey('C-S-p', { name: 'p', ctrl: true })).toBe(false);
    expect(matchesKey('tab', { name: 'tab' })).toBe(true);
    expect(matchesKey('S-tab', { name: 'tab', shift: true })).toBe(true);
  });

  test('contributedLLMTools: includes host tools and active plugin tools', async () => {
    expect(host.contributedLLMTools().map(t => t.name)).toEqual([
      'execution_list',
      'execution_get',
      'execution_cancel',
      'execution_rerun',
      'theme_getState',
      'theme_setActive',
    ]);
    writePlugin(builtinDir, 'withtools', `
      export default {
        name: 'withtools', version: '0', description: '',
        initialState: () => ({ n: 0 }),
        panes: {},
        llmTools: [
          { name: 'bump', description: 'increment',
            parameters: { type: 'object', properties: {} },
            handler: (_a, ctx) => { ctx.setState({ n: ctx.state.n + 1 }); return { n: ctx.state.n }; } },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('withtools');
    const tools = host.contributedLLMTools();
    expect(tools.map(t => t.name)).toContain('bump');
  });

  test('theme host tools use themeControl hooks', async () => {
    const h = makeHooks();
    let active = 'default';
    h.themeControl = {
      getState: () => ({ active }),
      setActive: (id) => { active = id; return { active }; },
    };
    const themeHost = new PluginHost(h);
    expect(await themeHost.dispatchTool('theme_getState', {})).toEqual({ ok: true, result: { active: 'default' } });
    expect(await themeHost.dispatchTool('theme_setActive', { id: 'plugin:demo.ocean' })).toEqual({
      ok: true,
      result: { active: 'plugin:demo.ocean' },
    });
    expect(active).toBe('plugin:demo.ocean');
  });

  test('plugin context exposes dashboard pane controls when host wires them', async () => {
    const h = makeHooks();
    const calls: string[] = [];
    h.panes = {
      state: () => ({
        activeViewId: 'agents',
        viewLabel: 'Agents',
        baseView: 1,
        focused: 'agent-roster',
        compactLevel: 'tabletMini',
        primary: 'agent-roster',
        panes: [
          { pane: 'agent-roster', visible: true, closed: false, closeable: false, omittedReason: null },
          { pane: 'agent-detail', visible: false, closed: false, closeable: true, omittedReason: 'modal-deferred' },
        ],
      }),
      close: (pane) => { calls.push(`close:${pane}`); return true; },
      open: (pane) => { calls.push(`open:${pane}`); return true; },
      openModal: (pane) => { calls.push(`modal:${pane}`); return true; },
      setOmitOrder: (panes) => {
        calls.push(`omit:${panes.join(',')}`);
        return h.panes!.state();
      },
    };
    const paneHost = new PluginHost(h);
    writePlugin(builtinDir, 'pane-tools', `
      export default {
        name: 'pane-tools', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        llmTools: [
          { name: 'paneProbe', description: 'probe panes',
            parameters: { type: 'object', properties: {} },
            handler: (_a, ctx) => {
              ctx.panes.close('agent-detail');
              ctx.panes.open('agent-detail');
              ctx.panes.openModal('agent-detail');
              const state = ctx.panes.setOmitOrder(['agent-detail', 'agent-roster']);
              return { visible: ctx.panes.visible(), compact: state.compactLevel };
            } },
        ],
      };
    `);
    await (paneHost as any).scanDir(builtinDir, 'builtin');
    await paneHost.activate('pane-tools');

    const res = await paneHost.dispatchTool('paneProbe', {});

    expect(res).toEqual({ ok: true, result: { visible: ['agent-roster'], compact: 'tabletMini' } });
    expect(calls).toEqual([
      'close:agent-detail',
      'open:agent-detail',
      'modal:agent-detail',
      'omit:agent-detail,agent-roster',
    ]);
  });

  test('manifest aiTools schema overrides runtime tool metadata', async () => {
    const pluginDir = join(builtinDir, 'manifest-tool');
    mkdirSync(join(pluginDir, 'schemas'), { recursive: true });
    writeFileSync(join(pluginDir, 'schemas', 'lookup.json'), JSON.stringify({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    }));
    writePluginManifest(builtinDir, 'manifest-tool', {
      id: 'manifest-tool',
      name: 'Manifest Tool',
      version: '1.0.0',
      contributes: {
        aiTools: [{ name: 'lookup', description: 'Manifest lookup', schema: './schemas/lookup.json' }],
      },
    });
    writePlugin(builtinDir, 'manifest-tool', `
      export default {
        initialState: () => ({}),
        panes: {},
        llmTools: [
          { name: 'lookup', description: 'runtime lookup',
            parameters: { type: 'object', properties: {} },
            handler: (args) => ({ q: args.q }) },
        ],
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('manifest-tool');

    const tool = host.contributedLLMTools().find(t => t.name === 'lookup')!;
    expect(tool.description).toBe('Manifest lookup');
    expect(tool.parameters).toMatchObject({ required: ['q'] });
    const res = await host.dispatchTool('lookup', { q: 'abc' });
    expect(res).toEqual({ ok: true, result: { q: 'abc' } });
  });

  test('manifest aiTools can load a TypeScript handler module', async () => {
    const pluginDir = join(builtinDir, 'handler-tool');
    mkdirSync(join(pluginDir, 'tools'), { recursive: true });
    writePluginManifest(builtinDir, 'handler-tool', {
      id: 'handler-tool',
      name: 'Handler Tool',
      version: '1.0.0',
      contributes: {
        aiTools: [{
          name: 'from_handler',
          description: 'Handler file',
          parameters: { type: 'object', properties: { n: { type: 'number' } } },
          handler: './tools/from_handler.ts',
        }],
      },
    });
    writeFileSync(join(pluginDir, 'tools', 'from_handler.ts'), `
      export default async function(args, ctx) {
        ctx.log('tool:' + args.n);
        return { doubled: args.n * 2 };
      }
    `);
    writePlugin(builtinDir, 'handler-tool', `
      export default {
        initialState: () => ({}),
        panes: {},
      };
    `);

    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('handler-tool');

    expect(host.contributedLLMTools().map(t => t.name)).toContain('from_handler');
    const res = await host.dispatchTool('from_handler', { n: 4 });
    expect(res).toEqual({ ok: true, result: { doubled: 8 } });
    expect(hooks.logs).toContain('tool:4');
  });

  test('dispatchTool: unknown name returns error shape', async () => {
    const res = await host.dispatchTool('does-not-exist', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unknown tool');
  });

  test('dispatchTool: handler returning value becomes result', async () => {
    writePlugin(builtinDir, 'tool-ok', `
      export default {
        name: 'tool-ok', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        llmTools: [
          { name: 'echo', description: '',
            parameters: { type: 'object', properties: { x: { type: 'string' } } },
            handler: (args) => ({ echoed: args.x }) },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('tool-ok');
    const res = await host.dispatchTool('echo', { x: 'hi' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ echoed: 'hi' });
  });

  test('dispatchTool: handler throw → structured error, no rethrow', async () => {
    writePlugin(builtinDir, 'tool-bad', `
      export default {
        name: 'tool-bad', version: '0', description: '',
        initialState: () => ({}),
        panes: {},
        llmTools: [
          { name: 'boom', description: '',
            parameters: { type: 'object', properties: {} },
            handler: () => { throw new Error('kaboom'); } },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('tool-bad');
    const res = await host.dispatchTool('boom', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('kaboom');
  });

  test('dispatchTool: handler gets working PluginContext (setState roundtrip)', async () => {
    writePlugin(builtinDir, 'tool-ctx', `
      export default {
        name: 'tool-ctx', version: '0', description: '',
        initialState: () => ({ n: 0 }),
        panes: {},
        llmTools: [
          { name: 'bumpN', description: '',
            parameters: { type: 'object', properties: { by: { type: 'number' } } },
            handler: (args, ctx) => {
              const cur = ctx.state.n;
              ctx.setState({ n: cur + args.by });
              return { n: ctx.state.n };
            } },
        ],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('tool-ctx');
    const res = await host.dispatchTool('bumpN', { by: 3 });
    expect(res.ok).toBe(true);
    expect((host.active()?.state as any).n).toBe(3);
  });

  test('setState patches active plugin state + triggers render', async () => {
    writePlugin(builtinDir, 'demo', `
      export default {
        name: 'demo', version: '0', description: '',
        initialState: () => ({ count: 0, label: 'init' }),
        panes: {},
        slashCommands: [{
          name: 'bump', description: '',
          handler: (_a, ctx) => { ctx.setState({ count: 7 }); },
        }],
      };
    `);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('demo');
    await host.dispatchSlash('bump', []);
    expect((host.active()?.state as any).count).toBe(7);
    expect((host.active()?.state as any).label).toBe('init');
    expect(hooks.renders.length).toBeGreaterThan(0);
  });
});
