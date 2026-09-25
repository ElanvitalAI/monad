// ── PC-INTRO (Bundle 3) — WidgetHost.listTypes() tests ──
//
// Verifies the introspection API used by `PluginContext.listWidgetTypes()`.
// Expectations: returns metadata snapshot per registered type, includes
// builtin / user / plugin sources, omits filesystem path + def function
// references, mutating the returned array does not affect the registry.

import { describe, test, expect, beforeEach } from 'bun:test';
import { WidgetHost, type WidgetHostHooks } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

function makeHooks(): WidgetHostHooks {
  return { log: () => {}, requestRender: () => {} };
}

const widgetA: WidgetDef<{ n: number }> = {
  type: 'widget-a',
  description: 'first test widget',
  defaultCharacter: 'A',
  initialState: () => ({ n: 0 }),
  render: () => [],
};

const widgetB: WidgetDef<{ s: string }> = {
  type: 'widget-b',
  description: 'second test widget',
  initialState: () => ({ s: '' }),
  render: () => [],
};

describe('WidgetHost.listTypes', () => {
  let host: WidgetHost;
  beforeEach(() => { host = new WidgetHost(makeHooks()); });

  test('empty registry returns empty array', () => {
    expect(host.listTypes()).toEqual([]);
  });

  test('one registered type returns one info entry', () => {
    host.register(widgetA);
    const list = host.listTypes();
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('widget-a');
    expect(list[0]!.description).toBe('first test widget');
    expect(list[0]!.defaultCharacter).toBe('A');
    expect(list[0]!.source).toBe('builtin');
  });

  test('omits defaultCharacter when widget has none', () => {
    host.register(widgetB);
    const list = host.listTypes();
    expect(list[0]!.defaultCharacter).toBeUndefined();
  });

  test('reflects source tag (builtin / user / plugin)', () => {
    host.register(widgetA, 'builtin');
    host.register(widgetB, 'plugin');
    const sources = new Set(host.listTypes().map(t => t.source));
    expect(sources.has('builtin')).toBe(true);
    expect(sources.has('plugin')).toBe(true);
  });

  test('returns a snapshot — mutating the array does not affect the registry', () => {
    host.register(widgetA);
    const snap = host.listTypes();
    snap.length = 0;
    expect(host.listTypes()).toHaveLength(1);
  });

  test('does not leak WidgetDef function references or filesystem path', () => {
    host.register(widgetA, 'builtin', '/some/path');
    const info = host.listTypes()[0]!;
    expect((info as Record<string, unknown>).path).toBeUndefined();
    expect((info as Record<string, unknown>).def).toBeUndefined();
    expect((info as Record<string, unknown>).initialState).toBeUndefined();
  });

  test('unregisterType removes from listTypes', () => {
    host.register(widgetA);
    host.register(widgetB);
    expect(host.listTypes()).toHaveLength(2);
    host.unregisterType('widget-a');
    expect(host.listTypes().map(t => t.type)).toEqual(['widget-b']);
  });
});
