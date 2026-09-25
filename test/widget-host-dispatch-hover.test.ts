// IDX-F5d Phase 2 — WidgetHost.dispatchHover invokes widget.onHover.
//
// Unit-scope contract: given an instance id + a WidgetHoverEvent,
// dispatchHover resolves the widget def, calls onHover with the
// current state + ctx, and swallows throws so a buggy override can't
// poison the hover pipeline.

import { describe, expect, test } from 'bun:test';

import { WidgetHost } from '../src/widgets/host.js';
import type { Widget, WidgetHoverEvent } from '../src/widgets/types.js';

interface TestState {
  events: WidgetHoverEvent[];
  mode: 'ok' | 'throw';
}

const makeDef = (): Widget<TestState> => ({
  type: 'test-widget',
  description: 'hover test',
  initialState: (): TestState => ({ events: [], mode: 'ok' }),
  render: () => [],
  onHover(ev, state) {
    if (state.mode === 'throw') throw new Error('boom');
    state.events.push(ev);
  },
});

const noopHooks = {
  log: () => {},
  requestRender: () => {},
};

describe('WidgetHost.dispatchHover', () => {
  test('invokes widget.onHover with the event', () => {
    const host = new WidgetHost(noopHooks);
    host.register(makeDef(), 'builtin', 'test');
    host.spawn({ type: 'test-widget', id: 'w1' });
    const ev: WidgetHoverEvent = { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 2 } };
    host.dispatchHover('w1', ev);
    const inst = host.get('w1') as { state: TestState };
    expect(inst.state.events.length).toBe(1);
    expect(inst.state.events[0]).toEqual(ev);
  });

  test('hover-over carries coordinates', () => {
    const host = new WidgetHost(noopHooks);
    host.register(makeDef(), 'builtin', 'test');
    host.spawn({ type: 'test-widget', id: 'w1' });
    const ev: WidgetHoverEvent = {
      kind: 'hover-over',
      hit: { kind: 'list-row', itemIndex: 1 },
      row: 5,
      col: 10,
    };
    host.dispatchHover('w1', ev);
    const inst = host.get('w1') as { state: TestState };
    expect(inst.state.events[0]).toEqual(ev);
  });

  test('unknown instance id → no-op (no throw)', () => {
    const host = new WidgetHost(noopHooks);
    host.register(makeDef(), 'builtin', 'test');
    // No spawn — 'w1' doesn't exist.
    expect(() => {
      host.dispatchHover('w1', { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 0 } });
    }).not.toThrow();
  });

  test('widget without onHover → no-op (no throw)', () => {
    const def: Widget<{ x: number }> = {
      type: 'no-hover',
      description: 'no onHover',
      initialState: () => ({ x: 0 }),
      render: () => [],
    };
    const host = new WidgetHost(noopHooks);
    host.register(def, 'builtin', 'test');
    host.spawn({ type: 'no-hover', id: 'n1' });
    expect(() => {
      host.dispatchHover('n1', { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 0 } });
    }).not.toThrow();
  });

  test('onHover throws → dispatch swallows (diagnostic log only)', () => {
    const host = new WidgetHost(noopHooks);
    host.register(makeDef(), 'builtin', 'test');
    host.spawn({ type: 'test-widget', id: 'w1' });
    const inst = host.get('w1') as { state: TestState };
    inst.state.mode = 'throw';
    expect(() => {
      host.dispatchHover('w1', { kind: 'hover-leave', hit: { kind: 'list-row', itemIndex: 0 } });
    }).not.toThrow();
  });

  test('all four hover kinds dispatch through to onHover', () => {
    const host = new WidgetHost(noopHooks);
    host.register(makeDef(), 'builtin', 'test');
    host.spawn({ type: 'test-widget', id: 'w1' });
    const events: WidgetHoverEvent[] = [
      { kind: 'hover-enter', hit: { kind: 'list-row', itemIndex: 0 } },
      { kind: 'hover-over', hit: { kind: 'list-row', itemIndex: 0 }, row: 1, col: 1 },
      { kind: 'hover-stable', hit: { kind: 'list-row', itemIndex: 0 } },
      { kind: 'hover-leave', hit: { kind: 'list-row', itemIndex: 0 } },
    ];
    for (const ev of events) host.dispatchHover('w1', ev);
    const inst = host.get('w1') as { state: TestState };
    expect(inst.state.events.map(e => e.kind)).toEqual([
      'hover-enter', 'hover-over', 'hover-stable', 'hover-leave',
    ]);
  });
});
