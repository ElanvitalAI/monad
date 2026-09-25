import { describe, expect, test } from 'bun:test';
import { CommandRegistry, censusRegisteredSlashOutputs } from '../src/command-registry.js';
import type { PluginContext, SlashCommand } from '../src/plugins/core/types.js';
import type { PluginManifest } from '../src/plugins/core/manifest.js';

function manifest(partial: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: './plugin.ts',
    activationEvents: ['onCommand'],
    contributes: {},
    capabilities: [],
    ...partial,
  };
}

function context(logs: string[]): PluginContext {
  return {
    pluginName: 'demo',
    state: {},
    setState: () => {},
    focus: { current: () => null, set: () => {}, cycle: () => null },
    keymap: { register: () => ({ dispose: () => {} }) },
    log: line => { logs.push(line); },
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
    getWidget: () => null,
    setLayout: () => {},
  };
}

describe('CommandRegistry', () => {
  test('registers, dispatches, and disposes commands by id and alias', async () => {
    const calls: string[] = [];
    const registry = new CommandRegistry();
    const disposable = registry.register({
      id: 'demo.run',
      title: 'Run',
      description: 'Run demo',
      aliases: ['run-demo'],
      hidden: false,
      handler: args => { calls.push(args.join(',')); },
    });

    expect(registry.has('demo.run')).toBe(true);
    expect(registry.has('run-demo')).toBe(true);
    expect(await registry.dispatch('run-demo', ['a', 'b'])).toBe(true);
    expect(calls).toEqual(['a,b']);

    disposable.dispose();
    expect(registry.has('demo.run')).toBe(false);
    expect(await registry.dispatch('run-demo', [])).toBe(false);
  });

  test('registerPluginCommands merges manifest metadata with slash handlers', async () => {
    const logs: string[] = [];
    const registry = new CommandRegistry();
    const commands: SlashCommand[] = [
      {
        name: 'demo.run',
        description: 'runtime desc',
        handler: (args, ctx) => ctx.log(`run:${args.join('|')}`),
      },
    ];

    registry.registerPluginCommands({
      pluginId: 'demo',
      manifest: manifest({
        contributes: {
          commands: [
            { name: 'demo.run', description: 'manifest desc', aliases: ['dr'], hidden: true },
            { name: 'demo.catalogOnly', description: 'catalog only' },
          ],
        },
      }),
      slashCommands: commands,
      context: () => context(logs),
    });

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: 'demo.catalogOnly', hidden: false }),
    ]);
    expect(registry.list({ includeHidden: true }).map(c => c.id)).toEqual(['demo.catalogOnly', 'demo.run']);
    expect(registry.get('demo.run')).toMatchObject({ description: 'manifest desc', aliases: ['dr'], hidden: true });
    expect(await registry.dispatch('dr', ['x'])).toBe(true);
    expect(logs).toEqual(['run:x']);
    expect(await registry.dispatch('demo.catalogOnly', [])).toBe(false);
  });

  test('censuses dispatch output into visible, hidden-only, and indeterminate buckets', async () => {
    const dispatched: string[] = [];
    const registry = {
      names: () => ['visible', 'hidden', 'silent', 'visible-throws', 'hidden-throws'] as const,
      dispatch: async (name: string, _args: string[], context: { visible(): void; hidden(): void }) => {
        dispatched.push(name);
        if (name === 'visible' || name === 'visible-throws') context.visible();
        if (name === 'hidden' || name === 'hidden-throws') context.hidden();
        if (name === 'visible-throws' || name === 'hidden-throws') throw new Error('probe dispatch failed');
      },
    };

    const census = await censusRegisteredSlashOutputs({
      registry,
      createContext: () => {
        let visibleOutput = false;
        let hiddenOutput = false;
        return {
          context: {
            visible: () => { visibleOutput = true; },
            hidden: () => { hiddenOutput = true; },
          },
          observe: () => ({ visibleOutput, hiddenOutput }),
        };
      },
    });

    expect(dispatched).toEqual(['visible', 'hidden', 'silent', 'visible-throws', 'hidden-throws']);
    expect(census).toMatchObject({ registeredTotal: 5, visibleOutput: 1, hiddenOnly: 1, indeterminate: 3 });
    expect(census.commands).toEqual([
      expect.objectContaining({ name: 'visible', classification: 'visible-output' }),
      expect.objectContaining({ name: 'hidden', classification: 'hidden-only' }),
      expect.objectContaining({ name: 'silent', classification: 'indeterminate' }),
      expect.objectContaining({ name: 'visible-throws', visibleOutput: true, classification: 'indeterminate' }),
      expect.objectContaining({ name: 'hidden-throws', hiddenOutput: true, classification: 'indeterminate' }),
    ]);
    expect(census.visibleOutput + census.hiddenOnly + census.indeterminate).toBe(census.registeredTotal);
  });
});
