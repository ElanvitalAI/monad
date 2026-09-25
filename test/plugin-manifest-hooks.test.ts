// ── PX-3 P4: contributes.hooks[] manifest parser + host wiring ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePluginManifest } from '../src/plugins/core/manifest';
import { PluginHost, type HostHooks } from '../src/plugins/core/host';
import { globalHookDispatcher } from '../src/plugin-hooks/dispatcher';

function makeHooks(): HostHooks & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (l) => logs.push(l),
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
  };
}

// ── Parser ─────────────────────────────────────────────────────────

describe('parseHooks (manifest)', () => {
  function parse(hooks: unknown): any {
    return parsePluginManifest({
      id: 'x', name: 'x', version: '1',
      contributes: { hooks },
    }, 'builtin').contributes.hooks;
  }

  test('minimal shell hook parses', () => {
    const out = parse([{ id: 'h1', event: 'Turn', command: 'echo {}' }]);
    expect(out).toEqual([{ id: 'h1', event: 'Turn', command: 'echo {}' }]);
  });

  test('priority + timeout + matcher preserved', () => {
    const out = parse([{
      id: 'h1', event: 'ToolCall', priority: 25, timeoutMs: 500,
      matcher: ['Read', 'Edit'], command: 'echo {}',
    }]);
    expect(out[0]).toEqual({
      id: 'h1', event: 'ToolCall', priority: 25, timeoutMs: 500,
      matcher: ['Read', 'Edit'], command: 'echo {}',
    });
  });

  test('invalid event name rejected', () => {
    expect(() => parse([{ id: 'h1', event: 'NotAnEvent', command: 'echo' }]))
      .toThrow(/event must be one of/);
  });

  test('duplicate id rejected', () => {
    expect(() => parse([
      { id: 'h1', event: 'Turn', command: 'echo' },
      { id: 'h1', event: 'Turn', command: 'echo' },
    ])).toThrow(/duplicated/);
  });

  test('missing command rejected', () => {
    expect(() => parse([{ id: 'h1', event: 'Turn' }]))
      .toThrow(/command is required/);
  });

  test('non-array rejected', () => {
    expect(() => parse({ wrong: true })).toThrow(/must be an array/);
  });
});

// ── Host wiring ────────────────────────────────────────────────────

describe('plugin-host hook registration', () => {
  let root: string;
  let builtinDir: string;
  let host: PluginHost;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mh-'));
    builtinDir = join(root, 'plugins');
    mkdirSync(builtinDir);
    host = new PluginHost(makeHooks());
    (host as any).scanOverride = { builtin: builtinDir, user: '/nonexistent' };
    // Clear any global dispatcher state from prior tests.
    globalHookDispatcher.clear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    globalHookDispatcher.clear();
  });

  async function writeHookPlugin(id: string, hooks: unknown[]): Promise<void> {
    const dir = join(builtinDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({
        id, name: id, version: '0.1.0', main: './plugin.ts',
        contributes: { hooks },
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(dir, 'plugin.ts'),
      `
      export default {
        name: '${id}',
        version: '0.1.0',
        description: 'test',
        initialState: () => ({}),
        panes: {},
      };
      `,
      'utf-8',
    );
  }

  test('activate registers manifest hooks; deactivate unregisters', async () => {
    await writeHookPlugin('px3-host-a', [
      { id: 'h1', event: 'Turn', command: 'echo \'{"systemPromptInject":"hello"}\'', priority: 50 },
    ]);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('px3-host-a');
    expect(globalHookDispatcher.list('Turn').length).toBe(1);
    expect(globalHookDispatcher.list('Turn')[0]!.id).toBe('px3-host-a:h1');

    await host.deactivate();
    expect(globalHookDispatcher.list('Turn').length).toBe(0);
  });

  test('end-to-end dispatch through registered manifest hook', async () => {
    await writeHookPlugin('px3-host-b', [
      { id: 'greet', event: 'Turn', command: 'echo \'{"systemPromptInject":"from-plugin"}\'' },
    ]);
    await (host as any).scanDir(builtinDir, 'builtin');
    await host.activate('px3-host-b');
    const r = await globalHookDispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.systemPromptInject).toBe('from-plugin');
  });
});
