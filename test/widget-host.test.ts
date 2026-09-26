// ── Widget host tests ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WidgetHost, type WidgetHostHooks } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';
import type { DisplayHandle } from '../src/display/types.js';
import { widget } from '../src/ui/declarative/index.js';
import {
  _resetWidgetSchemaRegistryForTest,
  getWidgetSchema,
  hasWidgetSchema,
} from '../src/ui/declarative/schema.js';

function makeHooks(): WidgetHostHooks & { logs: string[]; renders: number } {
  const logs: string[] = [];
  let renders = 0;
  return {
    logs,
    get renders() { return renders; },
    log: (l) => { logs.push(l); },
    requestRender: () => { renders++; },
  };
}

const fakeList: WidgetDef<{ count: number }> = {
  type: 'fake-list',
  description: 'test fixture',
  defaultCharacter: 'Fake',
  initialState: () => ({ count: 0 }),
  render: (state) => [`count:${state.count}`],
};

describe('WidgetHost registry', () => {
  let host: WidgetHost;
  let hooks: ReturnType<typeof makeHooks>;

  beforeEach(() => {
    _resetWidgetSchemaRegistryForTest();
    hooks = makeHooks();
    host = new WidgetHost(hooks);
    host.register(fakeList);
  });

  test('register + available lists the widget type', () => {
    expect(host.hasType('fake-list')).toBe(true);
    const avail = host.available();
    expect(avail).toHaveLength(1);
    expect(avail[0]?.def.type).toBe('fake-list');
    expect(avail[0]?.source).toBe('builtin');
  });

  test('spawn creates an instance with fresh state + default character', () => {
    const inst = host.spawn({ type: 'fake-list' });
    expect(inst.id).toMatch(/^fake-list-\d+$/);
    expect(inst.type).toBe('fake-list');
    expect(inst.character).toBe('Fake');
    expect((inst.state as any).count).toBe(0);
    expect(host.instanceCount()).toBe(1);
  });

  test('spawn accepts custom character + id', () => {
    const inst = host.spawn({ type: 'fake-list', character: 'Skills', id: 'my-skills' });
    expect(inst.id).toBe('my-skills');
    expect(inst.character).toBe('Skills');
  });

  test('spawn preserves declarative metadata when provided', () => {
    const inst = host.spawn({
      type: 'fake-list',
      id: 'meta-list',
      meta: {
        declarativeSpec: {
          type: 'fake-list',
          id: 'meta-list',
          chrome: { variant: 'window', title: 'Meta' },
        },
      },
    });
    expect(inst.meta).toEqual({
      declarativeSpec: {
        type: 'fake-list',
        id: 'meta-list',
        chrome: { variant: 'window', title: 'Meta' },
      },
    });
  });

  test('spawnDeclarative materializes builder-authored trees through the host', () => {
    const records = host.spawnDeclarative([
      widget('fake-list')
        .withId('root')
        .setChromeTitle('Telemetry')
        .withChild(
          widget('fake-list')
            .withId('child')
            .withCharacter('Leaf'),
        ),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      widgetId: 'root',
      type: 'fake-list',
      spec: {
        type: 'fake-list',
        id: 'root',
        chrome: { title: 'Telemetry' },
      },
    });
    expect(records[1]).toMatchObject({
      widgetId: 'child',
      type: 'fake-list',
      parentId: 'root',
    });
    expect(host.get('root')?.character).toBe('Telemetry');
    expect(host.get('child')?.character).toBe('Leaf');
    expect(host.get('child')?.meta).toEqual({
      declarativeSpec: {
        type: 'fake-list',
        id: 'child',
        character: 'Leaf',
      },
      parentId: 'root',
    });
  });

  test('spawn throws on unknown type', () => {
    expect(() => host.spawn({ type: 'ghost' })).toThrow(/not registered/);
  });

  test('spawn throws on id collision', () => {
    host.spawn({ type: 'fake-list', id: 'dup' });
    expect(() => host.spawn({ type: 'fake-list', id: 'dup' })).toThrow(/already exists/);
  });

  test('dispose removes instance', () => {
    const inst = host.spawn({ type: 'fake-list' });
    expect(host.instanceCount()).toBe(1);
    host.dispose(inst.id);
    expect(host.instanceCount()).toBe(0);
    expect(host.get(inst.id)).toBeNull();
  });

  test('buildContext.setState merges patch + triggers render', () => {
    const inst = host.spawn({ type: 'fake-list' });
    const ctx = host.buildContext<{ count: number }>(inst.id)!;
    const beforeRenders = hooks.renders;
    ctx.setState({ count: 7 });
    expect((host.get(inst.id)!.state as any).count).toBe(7);
    expect(hooks.renders).toBe(beforeRenders + 1);
  });

  test('buildContext exposes the scoped display handle', () => {
    const display: DisplayHandle = {
      owner: 'tool:widget-host',
      publish: () => {},
      requestRender: () => {},
      focus: () => {},
      currentFocus: () => null,
      cycleFocus: () => null,
      registerFocus: () => ({ dispose: () => {} }),
      registerKey: () => ({ dispose: () => {} }),
    };
    hooks.display = display;
    const inst = host.spawn({ type: 'fake-list' });
    const ctx = host.buildContext<{ count: number }>(inst.id)!;
    expect(ctx.display).toBe(display);
  });

  test('buildContext.dismiss removes instance', () => {
    const inst = host.spawn({ type: 'fake-list' });
    const ctx = host.buildContext(inst.id)!;
    ctx.dismiss();
    expect(host.instanceCount()).toBe(0);
  });

  test('defFor returns the WidgetDef for an instance', () => {
    const inst = host.spawn({ type: 'fake-list' });
    const def = host.defFor(inst.id);
    expect(def).toBe(fakeList);
  });

  test('registerFromFile loads a widget module and unregisterType removes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-widget-file-'));
    try {
      const widgetDir = join(root, 'widgets');
      mkdirSync(widgetDir, { recursive: true });
      const entry = join(widgetDir, 'demo.ts');
      writeFileSync(entry, `
        export default {
          type: 'plugin.demo',
          description: 'from file',
          initialState: (config) => ({ text: config?.text ?? 'empty' }),
          render: (state) => [state.text],
        };
      `);

      const def = await host.registerFromFile(entry, 'plugin', widgetDir);
      expect(def.type).toBe('plugin.demo');
      expect(host.hasType('plugin.demo')).toBe(true);
      const inst = host.spawn({ type: 'plugin.demo', config: { text: 'hello' } });
      expect((inst.state as any).text).toBe('hello');

      host.unregisterType('plugin.demo');
      expect(host.hasType('plugin.demo')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('discover loads built-in widgets from the repo root widgets directory', async () => {
    const freshHost = new WidgetHost(makeHooks());
    await freshHost.discover();
    expect(freshHost.hasType('list')).toBe(true);
    const inst = freshHost.spawn({ type: 'list', config: { items: ['a', 'b'] } });
    expect(inst.type).toBe('list');
  });

  test('register harvests configSchema into the declarative registry', () => {
    const schemaWidget: WidgetDef<{ n: number }, { value?: number }> = {
      type: 'schema-widget',
      description: 'schema fixture',
      initialState: () => ({ n: 0 }),
      render: () => [],
      configSchema() {
        return {
          type: 'object',
          properties: { value: { type: 'number' } },
          additionalProperties: false,
        };
      },
    };

    host.register(schemaWidget);
    expect(hasWidgetSchema('schema-widget')).toBe(true);
    expect((getWidgetSchema('schema-widget').configSchema.properties as Record<string, unknown>).value).toBeDefined();
  });

  test('re-register replaces harvested schema and unregister disposes it', () => {
    const v1: WidgetDef<{ n: number }> = {
      type: 'schema-widget',
      description: 'v1',
      initialState: () => ({ n: 0 }),
      render: () => [],
      configSchema() {
        return { type: 'object', properties: { alpha: { type: 'string' } }, additionalProperties: false };
      },
    };
    const v2: WidgetDef<{ n: number }> = {
      type: 'schema-widget',
      description: 'v2',
      initialState: () => ({ n: 0 }),
      render: () => [],
      configSchema() {
        return { type: 'object', properties: { beta: { type: 'number' } }, additionalProperties: false };
      },
    };

    host.register(v1);
    host.register(v2);
    const props = getWidgetSchema('schema-widget').configSchema.properties as Record<string, unknown>;
    expect(props.alpha).toBeUndefined();
    expect(props.beta).toBeDefined();

    host.unregisterType('schema-widget');
    expect(hasWidgetSchema('schema-widget')).toBe(false);
  });
});
