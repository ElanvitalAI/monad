// ── IUL Phase S·b — widget-surface adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  wireWidgetSurfaceAdapter,
  createSurfaceRegistry,
  type SurfaceRegistry,
} from '../src/surface/index.js';
import { WidgetHost, type WidgetLifecycleEvent } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

function makeHost(): WidgetHost {
  const host = new WidgetHost({ log: () => {}, requestRender: () => {} });
  const def: WidgetDef = {
    type: 'fake', description: 'test',
    initialState: () => ({}), render: () => [],
  };
  host.register(def, 'builtin');
  return host;
}

describe('widget-host lifecycle subscriptions', () => {
  test('onMount fires synchronously inside spawn', () => {
    const host = makeHost();
    const seen: WidgetLifecycleEvent[] = [];
    host.onMount(e => seen.push(e));
    const inst = host.spawn({ type: 'fake', id: 'a' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.instanceId).toBe('a');
    expect(seen[0]!.type).toBe('fake');
    expect(seen[0]!.character).toBe('fake');
    expect(seen[0]!.source).toBe('builtin');
    expect(typeof seen[0]!.timestamp).toBe('number');
    void inst;
  });

  test('onDispose fires synchronously inside dispose', () => {
    const host = makeHost();
    const seen: WidgetLifecycleEvent[] = [];
    host.onDispose(e => seen.push(e));
    host.spawn({ type: 'fake', id: 'b' });
    host.dispose('b');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.instanceId).toBe('b');
  });

  test('dispose on unknown id does not fire', () => {
    const host = makeHost();
    const seen: WidgetLifecycleEvent[] = [];
    host.onDispose(e => seen.push(e));
    host.dispose('never-spawned');
    expect(seen).toHaveLength(0);
  });

  test('subscriber unsubscribe stops further events', () => {
    const host = makeHost();
    const seen: WidgetLifecycleEvent[] = [];
    const off = host.onMount(e => seen.push(e));
    host.spawn({ type: 'fake', id: '1' });
    off();
    host.spawn({ type: 'fake', id: '2' });
    expect(seen).toHaveLength(1);
  });

  test('throwing subscriber does not break further fanout', () => {
    const host = makeHost();
    const good: number[] = [];
    host.onMount(() => { throw new Error('boom'); });
    host.onMount(() => good.push(1));
    host.spawn({ type: 'fake', id: 'x' });
    expect(good).toEqual([1]);
  });
});

describe('widget-surface-adapter', () => {
  function setup(): { reg: SurfaceRegistry; host: WidgetHost } {
    return { reg: createSurfaceRegistry(), host: makeHost() };
  }

  test('mount registers a {kind:widget} entry in the registry', () => {
    const { reg, host } = setup();
    wireWidgetSurfaceAdapter({ registry: reg, widgetHost: host });
    host.spawn({ type: 'fake', id: 'sparkline-1' });
    const desc = reg.get({ kind: 'widget', widgetId: 'sparkline-1' });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('fake');
    expect(desc!.surfaceId).toBe('sparkline-1');
    expect(desc!.tier).toBe('vw');
    expect(desc!.title).toBe('fake(sparkline-1)');
    expect(desc!.visible).toBe(true);
  });

  test('dispose unregisters the matching widget entry', () => {
    const { reg, host } = setup();
    wireWidgetSurfaceAdapter({ registry: reg, widgetHost: host });
    host.spawn({ type: 'fake', id: 'a' });
    host.dispose('a');
    expect(reg.get({ kind: 'widget', widgetId: 'a' })).toBeUndefined();
  });

  test('multiple widgets each get their own registry entry', () => {
    const { reg, host } = setup();
    wireWidgetSurfaceAdapter({ registry: reg, widgetHost: host });
    host.spawn({ type: 'fake', id: 'a' });
    host.spawn({ type: 'fake', id: 'b' });
    host.spawn({ type: 'fake', id: 'c' });
    expect(reg.listByKind('widget')).toHaveLength(3);
  });

  test('handle.dispose() detaches; future mounts no longer register', () => {
    const { reg, host } = setup();
    const handle = wireWidgetSurfaceAdapter({ registry: reg, widgetHost: host });
    host.spawn({ type: 'fake', id: 'a' });
    handle.dispose();
    host.spawn({ type: 'fake', id: 'b' });
    expect(reg.listByKind('widget')).toHaveLength(1);
    expect(reg.get({ kind: 'widget', widgetId: 'a' })).toBeDefined();
  });

  test('custom kindTagOf / titleOf / tierOf overrides apply', () => {
    const { reg, host } = setup();
    wireWidgetSurfaceAdapter({
      registry: reg, widgetHost: host,
      kindTagOf: e => `tag-${e.type}`,
      titleOf: e => `[${e.instanceId}]`,
      tierOf: () => 'modal',
    });
    host.spawn({ type: 'fake', id: 'q' });
    const desc = reg.get({ kind: 'widget', widgetId: 'q' });
    expect(desc!.kindTag).toBe('tag-fake');
    expect(desc!.title).toBe('[q]');
    expect(desc!.tier).toBe('modal');
  });

  test('uses global SurfaceRegistry when registry option omitted', () => {
    // Sanity — getSurfaceRegistry() singleton path. Don't pollute the
    // global; just verify the adapter doesn't crash without registry opt.
    const host = makeHost();
    const handle = wireWidgetSurfaceAdapter({ widgetHost: host });
    host.spawn({ type: 'fake', id: 'global-ping' });
    handle.dispose();
    // Clean up the global entry we just made.
    const { getSurfaceRegistry } = require('../src/surface/registry.js');
    (getSurfaceRegistry() as SurfaceRegistry).unregister({
      kind: 'widget', widgetId: 'global-ping',
    });
  });
});
