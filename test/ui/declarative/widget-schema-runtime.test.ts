// ── Presentation P3 · GetWidgetSchema LLM tool ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createGetWidgetSchemaRuntime,
  __resetWidgetSchemaRuntimeForTest,
} from '../../../src/tool-runtime/widget-schema-runtime.js';
import {
  registerWidgetSchema,
  _resetWidgetSchemaRegistryForTest,
} from '../../../src/ui/declarative/schema.js';
import { WidgetHost } from '../../../src/widgets/host.js';

beforeEach(() => {
  _resetWidgetSchemaRegistryForTest();
  __resetWidgetSchemaRuntimeForTest();
});

describe('GetWidgetSchema runtime', () => {
  test('spec exposes canonical name + description + params schema', () => {
    const rt = createGetWidgetSchemaRuntime();
    expect(rt.id).toBe('ui_get_widget_schema');
    expect(rt.spec.name).toBe('GetWidgetSchema');
    expect(rt.spec.parameters).toBeDefined();
  });

  test('returns entry for registered type · found: true', async () => {
    registerWidgetSchema({
      type: 'log',
      description: 'log widget',
      configSchema: { type: 'object', additionalProperties: false },
    });
    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ type: 'log' }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    expect(payload.found).toBe(true);
    expect(payload.schema.type).toBe('log');
    expect(payload.schema.description).toBe('log widget');
  });

  test('unregistered type returns permissive fallback · found: false', async () => {
    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ type: 'unknown' }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    expect(payload.found).toBe(false);
    expect(payload.schema.configSchema.additionalProperties).toBe(true);
  });

  test('listTypes: true enumerates every registration', async () => {
    registerWidgetSchema({ type: 'alpha', description: '', configSchema: {} });
    registerWidgetSchema({ type: 'zebra', description: '', configSchema: {} });
    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ listTypes: true }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    const types = new Set((payload.types as Array<{ type: string }>).map((entry) => entry.type));
    expect(types.has('alpha')).toBe(true);
    expect(types.has('zebra')).toBe(true);
    expect(types.has('tooltip')).toBe(true);
  });

  test('built-in declarative view schemas resolve as found types', async () => {
    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ type: 'permission-prompt' }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    expect(payload.found).toBe(true);
    expect(payload.schema.type).toBe('permission-prompt');
    expect(payload.schema.configSchema.required).toContain('choices');
  });

  test('missing type + no listTypes → error message', async () => {
    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({}, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    expect(payload.error).toContain('provide');
  });

  test('host-discovered built-ins appear in runtime listTypes', async () => {
    const host = new WidgetHost({ log: () => {}, requestRender: () => {} });
    await host.discover();

    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ listTypes: true }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    const types = new Set((payload.types as Array<{ type: string }>).map((entry) => entry.type));

    expect(types.has('list')).toBe(true);
    expect(types.has('markdown')).toBe(true);
    expect(types.has('table')).toBe(true);
    expect(types.has('chart-line')).toBe(true);
  });

  test('host-discovered built-ins have no schema coverage gaps', async () => {
    const host = new WidgetHost({ log: () => {}, requestRender: () => {} });
    await host.discover();

    const rt = createGetWidgetSchemaRuntime();
    const res = await rt.run({ listTypes: true }, { surface: 'skill' });
    const payload = JSON.parse(res.output);
    const schemaTypes = new Set((payload.types as Array<{ type: string }>).map((entry) => entry.type));
    const missing = host.available()
      .map((entry) => entry.def.type)
      .filter((type) => !schemaTypes.has(type));

    expect(missing).toEqual([]);
  });
});
