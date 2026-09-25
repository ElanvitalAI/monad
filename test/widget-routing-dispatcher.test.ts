import { describe, expect, test } from 'bun:test';
import { dispatchKeyToWidget, type WidgetHostLike } from '../src/widget-routing/widget-dispatcher.js';
import type { Key } from '../src/tui.js';
import type { Widget, WidgetContext, Action } from '../src/widgets/types.js';
import type { WidgetBehavior } from '../src/widget-behaviors/types.js';

// ── Helpers ────────────────────────────────────────────────────────

function mkKey(name: string, extra: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...extra };
}

interface TestState {
  count: number;
  lastHandler?: string;
}

function mkCtx(state: TestState, widgetId = 'test-widget'): WidgetContext<TestState> {
  return {
    widgetId,
    widgetType: 'test',
    character: 'T',
    state,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
  };
}

function mkHost(
  def: Widget<TestState, unknown>,
  state: TestState,
  widgetId = 'test-widget',
): WidgetHostLike {
  return {
    get: (id) => (id === widgetId ? { state } : undefined),
    defFor: (id) => (id === widgetId ? (def as Widget<unknown, unknown>) : undefined),
    buildContext: (id) => mkCtx(state, id) as WidgetContext<unknown>,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('dispatchKeyToWidget', () => {
  test('returns null when widget is not registered', () => {
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => ({ count: 0 }),
      render: () => [],
    };
    const host = mkHost(def, { count: 0 });
    const result = dispatchKeyToWidget(host, 'NONEXISTENT', mkKey('j'));
    expect(result).toBeNull();
  });

  test('calls widget.onKey when no behaviors are declared', () => {
    const state: TestState = { count: 0 };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      onKey(key, s) {
        s.count += 1;
        s.lastHandler = 'widget.onKey';
        return { type: 'refresh' };
      },
    };
    const host = mkHost(def, state);
    const result = dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(result).toEqual({ type: 'refresh' });
    expect(state.count).toBe(1);
    expect(state.lastHandler).toBe('widget.onKey');
  });

  test('behavior with handlesKey=true claims the key', () => {
    const state: TestState = { count: 0 };
    const beh: WidgetBehavior<TestState> = {
      name: 'test-behavior',
      handlesKey: (key) => key.name === 'j',
      onKey: (_key, s): Action => {
        s.count += 1;
        s.lastHandler = 'behavior';
        return { type: 'refresh' };
      },
    };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      behaviors: [beh],
      onKey(_key, s) {
        s.lastHandler = 'widget.onKey';  // should NOT run for 'j'
        return { type: 'none' };
      },
    };
    const host = mkHost(def, state);
    const result = dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(result).toEqual({ type: 'refresh' });
    expect(state.lastHandler).toBe('behavior');
    expect(state.count).toBe(1);
  });

  test('widget.onKey runs when no behavior claims the key', () => {
    const state: TestState = { count: 0 };
    const beh: WidgetBehavior<TestState> = {
      name: 'test-behavior',
      handlesKey: (key) => key.name === 'j',  // only claims 'j'
      onKey: (_key, s): Action => {
        s.lastHandler = 'behavior';
        return { type: 'refresh' };
      },
    };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      behaviors: [beh],
      onKey(_key, s) {
        s.lastHandler = 'widget.onKey';
        return { type: 'refresh' };
      },
    };
    const host = mkHost(def, state);
    // 'k' is NOT claimed by the behavior — widget.onKey should run.
    const result = dispatchKeyToWidget(host, 'test-widget', mkKey('k'));
    expect(result).toEqual({ type: 'refresh' });
    expect(state.lastHandler).toBe('widget.onKey');
  });

  test('first behavior that claims wins — later behaviors not invoked', () => {
    const state: TestState = { count: 0 };
    let bCalled = false;
    const beh1: WidgetBehavior<TestState> = {
      name: 'first',
      handlesKey: () => true,
      onKey: (_k, s): Action => {
        s.lastHandler = 'first';
        return { type: 'refresh' };
      },
    };
    const beh2: WidgetBehavior<TestState> = {
      name: 'second',
      handlesKey: () => {
        bCalled = true;
        return true;
      },
      onKey: (_k, s): Action => {
        s.lastHandler = 'second';
        return { type: 'refresh' };
      },
    };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      behaviors: [beh1, beh2],
    };
    const host = mkHost(def, state);
    dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(state.lastHandler).toBe('first');
    expect(bCalled).toBe(false);
  });

  test('behavior without handlesKey is skipped', () => {
    const state: TestState = { count: 0 };
    const beh: WidgetBehavior<TestState> = {
      name: 'no-claim',
      // no handlesKey → never claims
      onKey: (_k, s): Action => {
        s.lastHandler = 'no-claim';
        return { type: 'refresh' };
      },
    };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      behaviors: [beh],
      onKey: (_k, s) => {
        s.lastHandler = 'widget.onKey';
        return { type: 'refresh' };
      },
    };
    const host = mkHost(def, state);
    dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(state.lastHandler).toBe('widget.onKey');
  });

  test('returns null when no behavior claims and widget has no onKey', () => {
    const state: TestState = { count: 0 };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      // no behaviors, no onKey
    };
    const host = mkHost(def, state);
    const result = dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(result).toBeNull();
  });

  test('behavior returning falsy onKey result falls through to widget.onKey', () => {
    // Edge case: behavior claims the key (handlesKey=true) but its
    // onKey returns undefined (e.g. early-return guard). Dispatcher
    // should continue to widget.onKey.
    const state: TestState = { count: 0 };
    const beh: WidgetBehavior<TestState> = {
      name: 'claim-no-action',
      handlesKey: () => true,
      onKey: () => undefined as unknown as Action,
    };
    const def: Widget<TestState> = {
      type: 'test',
      description: 'test',
      initialState: () => state,
      render: () => [],
      behaviors: [beh],
      onKey: (_k, s) => {
        s.lastHandler = 'widget.onKey';
        return { type: 'refresh' };
      },
    };
    const host = mkHost(def, state);
    dispatchKeyToWidget(host, 'test-widget', mkKey('j'));
    expect(state.lastHandler).toBe('widget.onKey');
  });
});
