// ── Presentation P3 · WidgetSchemaRegistry ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  registerWidgetSchema,
  harvestWidgetSchema,
  getWidgetSchema,
  hasWidgetSchema,
  listWidgetSchemas,
  _resetWidgetSchemaRegistryForTest,
} from '../../../src/ui/declarative/schema.js';
import { ensureBuiltinDeclarativeViewSchemasRegistered } from '../../../src/ui/declarative/builtin-view-schemas.js';

beforeEach(() => {
  _resetWidgetSchemaRegistryForTest();
});

describe('WidgetSchemaRegistry · register + lookup', () => {
  test('registerWidgetSchema + getWidgetSchema round-trip', () => {
    registerWidgetSchema({
      type: 'demo',
      description: 'demo',
      configSchema: { type: 'object', additionalProperties: false },
    });
    const entry = getWidgetSchema('demo');
    expect(entry.type).toBe('demo');
    expect(entry.description).toBe('demo');
    expect(entry.configSchema.additionalProperties).toBe(false);
  });

  test('hasWidgetSchema · true only for explicit registrations', () => {
    expect(hasWidgetSchema('demo')).toBe(false);
    registerWidgetSchema({ type: 'demo', description: '', configSchema: {} });
    expect(hasWidgetSchema('demo')).toBe(true);
  });

  test('unregistered type returns permissive fallback', () => {
    const fallback = getWidgetSchema('never-registered');
    expect(fallback.type).toBe('never-registered');
    expect(fallback.configSchema.additionalProperties).toBe(true);
    expect(fallback.description.includes('no schema registered')).toBe(true);
  });

  test('register idempotent — re-registering replaces entry', () => {
    registerWidgetSchema({ type: 'demo', description: 'v1', configSchema: {} });
    registerWidgetSchema({ type: 'demo', description: 'v2', configSchema: {} });
    expect(getWidgetSchema('demo').description).toBe('v2');
  });

  test('register returns disposer that unregisters entry', () => {
    const dispose = registerWidgetSchema({ type: 'demo', description: '', configSchema: {} });
    expect(hasWidgetSchema('demo')).toBe(true);
    dispose();
    expect(hasWidgetSchema('demo')).toBe(false);
  });

  test('listWidgetSchemas sorted alphabetically', () => {
    registerWidgetSchema({ type: 'zebra', description: '', configSchema: {} });
    registerWidgetSchema({ type: 'alpha', description: '', configSchema: {} });
    registerWidgetSchema({ type: 'mango', description: '', configSchema: {} });
    const types = listWidgetSchemas().map((e) => e.type);
    expect(types).toEqual(['alpha', 'mango', 'zebra']);
  });

  test('empty type string is rejected', () => {
    expect(() =>
      registerWidgetSchema({ type: '', description: '', configSchema: {} }),
    ).toThrow();
  });
});

describe('harvestWidgetSchema', () => {
  test('reads configSchema() from def and registers', () => {
    const def = {
      type: 'sample',
      description: 'sample widget',
      configSchema() {
        return { type: 'object', properties: { x: { type: 'number' } } };
      },
    };
    const dispose = harvestWidgetSchema(def);
    expect(dispose).not.toBeNull();
    expect(hasWidgetSchema('sample')).toBe(true);
    const entry = getWidgetSchema('sample');
    expect((entry.configSchema.properties as Record<string, unknown>).x).toBeDefined();
    dispose?.();
    expect(hasWidgetSchema('sample')).toBe(false);
  });

  test('returns null when def lacks configSchema hook', () => {
    const def = { type: 'no-schema', description: '' };
    expect(harvestWidgetSchema(def)).toBeNull();
    expect(hasWidgetSchema('no-schema')).toBe(false);
  });

  test('decorationSupported option flows into entry', () => {
    harvestWidgetSchema(
      { type: 'chrome', description: '', configSchema: () => ({}) },
      { decorationSupported: true },
    );
    expect(getWidgetSchema('chrome').decorationSupported).toBe(true);
  });
});

describe('ensureBuiltinDeclarativeViewSchemasRegistered', () => {
  test('registers declarative LC view wrapper schemas', () => {
    expect(hasWidgetSchema('tooltip')).toBe(false);
    expect(hasWidgetSchema('permission-prompt')).toBe(false);

    ensureBuiltinDeclarativeViewSchemasRegistered();

    expect(hasWidgetSchema('tooltip')).toBe(true);
    expect(hasWidgetSchema('permission-prompt')).toBe(true);
    expect((getWidgetSchema('dialog').configSchema.properties as Record<string, unknown>).buttons).toBeDefined();
  });
});
