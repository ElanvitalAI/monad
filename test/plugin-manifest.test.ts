import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadPluginManifestFromDir,
  manifestRequiredWidgets,
  parsePluginManifest,
} from '../src/plugins/core/manifest.js';

describe('plugin manifest parser', () => {
  test('parses V2 plugin.json fields and contributions', () => {
    const manifest = parsePluginManifest({
      id: 'demo.plugin',
      name: 'Demo Plugin',
      version: '1.2.3',
      main: './src/plugin.ts',
      activationEvents: ['onCommand:demo.run'],
      capabilities: [{ kind: 'process:spawn', commands: ['python3'] }, 'display:surface'],
      dependencies: { widgets: ['table'] },
      contributes: {
        commands: [{ name: 'demo.run', description: 'Run demo', hidden: true }],
        keybindings: [{ key: 'C-r', command: 'demo.run', when: 'focused' }],
        widgets: [{ type: 'demo-widget', entry: './widgets/demo.ts', title: 'Demo Widget' }],
        panes: [{ id: 'status', widget: 'demo-widget', title: 'Status', config: { text: 'ok' } }],
        views: [{ id: 'demo-view', label: 'Demo View', rows: [{ panes: ['status', 'log'] }] }],
        modals: [{ id: 'demo.pick', widget: 'demo-widget', title: 'Picker', size: { width: 60, height: 12 } }],
        themes: [{ id: 'demo-dark', path: './themes/demo-dark.json' }],
        tasks: [{ id: 'demo.test', command: 'bun', args: ['test'], cwd: '${workspace}', reveal: 'always' }],
        aiTools: [{ name: 'demo_tool', description: 'Tool', schema: './schemas/demo_tool.json', handler: './tools/demo_tool.ts' }],
        prompts: [{
          id: 'demo-context',
          name: 'Demo Context',
          path: './prompts/context.md',
          targetSlot: 'context',
          tags: ['demo'],
          triggers: { view: 'debug' },
        }],
      },
    });

    expect(manifest.id).toBe('demo.plugin');
    expect(manifest.main).toBe('./src/plugin.ts');
    expect(manifest.capabilities.map(c => c.kind)).toEqual(['process:spawn', 'display:surface']);
    expect(manifest.contributes.commands?.[0]).toMatchObject({ name: 'demo.run', hidden: true });
    expect(manifest.contributes.keybindings?.[0]).toEqual({ key: 'C-r', command: 'demo.run', when: 'focused' });
    expect(manifest.contributes.widgets?.[0]).toMatchObject({ type: 'demo-widget', entry: './widgets/demo.ts' });
    expect(manifest.contributes.panes?.[0]).toMatchObject({ id: 'status', widget: 'demo-widget', title: 'Status' });
    expect(manifest.contributes.views?.[0]).toMatchObject({ id: 'demo-view', label: 'Demo View' });
    expect(manifest.contributes.modals?.[0]).toMatchObject({ id: 'demo.pick', widget: 'demo-widget' });
    expect(manifest.contributes.tasks?.[0]).toMatchObject({ id: 'demo.test', command: 'bun', args: ['test'] });
    expect(manifest.contributes.aiTools?.[0]).toMatchObject({
      name: 'demo_tool',
      schema: './schemas/demo_tool.json',
      handler: './tools/demo_tool.ts',
    });
    expect(manifest.contributes.prompts?.[0]).toMatchObject({
      id: 'demo-context',
      name: 'Demo Context',
      path: './prompts/context.md',
      targetSlot: 'context',
      tags: ['demo'],
      triggers: { view: 'debug' },
    });
    expect(manifestRequiredWidgets(manifest)).toEqual(['table']);
  });

  test('parses portable classifier buckets under contributes', () => {
    const manifest = parsePluginManifest({
      id: 'portable.plugin',
      contributes: {
        agents: [{ id: 'reviewer', systemPrompt: 'review' }],
        skills: [{ name: 'dig' }],
        tools: [{ name: 'quote' }],
        mcpServers: [{ name: 'local-mcp' }],
        providers: [{ name: 'grok' }],
        hooks: [{ id: 'on-turn', event: 'Turn', command: 'echo' }],
      },
    });
    expect(manifest.contributes.agents?.[0]).toMatchObject({ id: 'reviewer' });
    expect(manifest.contributes.skills?.[0]).toMatchObject({ name: 'dig' });
    expect(manifest.contributes.tools?.[0]).toMatchObject({ name: 'quote' });
    expect(manifest.contributes.mcpServers?.[0]).toMatchObject({ name: 'local-mcp' });
    expect(manifest.contributes.providers?.[0]).toMatchObject({ name: 'grok' });
    expect(manifest.contributes.hooks?.[0]).toMatchObject({ id: 'on-turn' });
  });

  test('inferred empty contributes stay empty when plugin.json is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-manifest-empty-'));
    try {
      const pluginDir = join(root, 'legacy');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.ts'), 'export default {};');
      const loaded = loadPluginManifestFromDir(pluginDir, { id: 'legacy' });
      expect(loaded.inferred).toBe(true);
      expect(loaded.manifest.contributes).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('infers a legacy manifest when plugin.json is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-manifest-'));
    try {
      const pluginDir = join(root, 'legacy');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'plugin.ts'), 'export default {};');

      const loaded = loadPluginManifestFromDir(pluginDir, { id: 'legacy' });

      expect(loaded.inferred).toBe(true);
      expect(loaded.path).toBeNull();
      expect(loaded.manifest).toMatchObject({
        id: 'legacy',
        name: 'legacy',
        version: '0.0.0',
        main: './plugin.ts',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('loads .monad-plugin/plugin.json as an alternative location', () => {
    const root = mkdtempSync(join(tmpdir(), 'monad-manifest-'));
    try {
      const pluginDir = join(root, 'demo');
      mkdirSync(join(pluginDir, '.monad-plugin'), { recursive: true });
      writeFileSync(join(pluginDir, '.monad-plugin', 'plugin.json'), JSON.stringify({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        main: './entry.ts',
      }));

      const loaded = loadPluginManifestFromDir(pluginDir, { id: 'fallback' });

      expect(loaded.inferred).toBe(false);
      expect(loaded.path).toEndWith('.monad-plugin/plugin.json');
      expect(loaded.manifest.id).toBe('demo');
      expect(loaded.manifest.main).toBe('./entry.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects unsafe main paths and invalid ids', () => {
    expect(() => parsePluginManifest({ id: '../bad', main: './plugin.ts' })).toThrow(/invalid id/);
    expect(() => parsePluginManifest({ id: 'ok', main: '../plugin.ts' })).toThrow(/unsafe path/);
    expect(() => parsePluginManifest({ id: 'ok', main: '/tmp/plugin.ts' })).toThrow(/unsafe path/);
    expect(() => parsePluginManifest({
      id: 'ok',
      main: './plugin.ts',
      contributes: { prompts: [{ id: 'bad', path: '../secret.md' }] },
    })).toThrow(/unsafe path/);
  });
});
