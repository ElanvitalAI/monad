import { describe, expect, test } from 'bun:test';
import {
  themable, Themable,
  stateStyleable, StateStyleable, resolveStyle, type StateStyleableState,
} from '../src/widget-behaviors/index.js';
import type { WidgetContext, StateMap, StyleSpec, WidgetState } from '../src/widgets/types.js';

function mkCtx<S>(state: S, widgetId = 'test-widget'): WidgetContext<S> {
  let renderCalls = 0;
  return {
    widgetId,
    widgetType: 'test',
    character: 'T',
    state,
    setState: () => {},
    requestRender: () => { renderCalls++; },
    dismiss: () => {},
    log: () => {},
    // expose counter for tests via a side channel
    get __renderCalls() { return renderCalls; },
  } as WidgetContext<S> & { __renderCalls: number };
}

// ── Themable ────────────────────────────────────────────────────────

describe('themable', () => {
  test('default Themable is a no-op marker', () => {
    // No subscribe → onMount/onUnmount run without side effects.
    const ctx = mkCtx({});
    expect(() => Themable.onMount!({}, ctx)).not.toThrow();
    expect(() => Themable.onUnmount!({}, ctx)).not.toThrow();
  });

  test('factory subscribe wires requestRender on theme change', () => {
    const listeners: Array<() => void> = [];
    const fakeSubscribe = (fn: () => void) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    };

    const b = themable({ subscribe: fakeSubscribe });
    const ctx = mkCtx({}) as WidgetContext<{}> & { __renderCalls: number };

    b.onMount!({}, ctx);
    expect(listeners.length).toBe(1);
    expect(ctx.__renderCalls).toBe(0);

    // Fire theme change — should trigger requestRender.
    listeners[0]!();
    expect(ctx.__renderCalls).toBe(1);

    listeners[0]!();
    expect(ctx.__renderCalls).toBe(2);

    // onUnmount disposes.
    b.onUnmount!({}, ctx);
    expect(listeners.length).toBe(0);
  });

  test('multiple widgets share one factory instance, each gets its own dispose', () => {
    const active = new Set<() => void>();
    const subscribe = (fn: () => void) => {
      active.add(fn);
      return () => { active.delete(fn); };
    };

    const b = themable({ subscribe });
    const ctx1 = mkCtx({}, 'w1');
    const ctx2 = mkCtx({}, 'w2');

    b.onMount!({}, ctx1);
    b.onMount!({}, ctx2);
    expect(active.size).toBe(2);

    b.onUnmount!({}, ctx1);
    expect(active.size).toBe(1);

    b.onUnmount!({}, ctx2);
    expect(active.size).toBe(0);
  });

  test('remount under same widgetId cleans up the stale subscription', () => {
    const live = new Set<symbol>();
    let tag = 0;
    const subscribe = (_fn: () => void) => {
      const s = Symbol(String(tag++));
      live.add(s);
      return () => { live.delete(s); };
    };

    const b = themable({ subscribe });
    const ctx = mkCtx({}, 'w1');

    b.onMount!({}, ctx);
    expect(live.size).toBe(1);
    // Simulate remount without explicit unmount (defensive).
    b.onMount!({}, ctx);
    expect(live.size).toBe(1); // stale disposed, new one added

    b.onUnmount!({}, ctx);
    expect(live.size).toBe(0);
  });
});

// ── StateStyleable + resolveStyle ──────────────────────────────────

describe('stateStyleable', () => {
  test('default widgetState initialized on mount if undefined', () => {
    type S = StateStyleableState;
    const state = {} as S; // intentionally missing widgetState
    StateStyleable.onMount!(state, mkCtx(state) as WidgetContext<unknown>);
    expect(state.widgetState).toBe('default');
  });

  test('onFocus flips to focused, onBlur returns to default', () => {
    const state: StateStyleableState = { widgetState: 'default' };
    const ctx = mkCtx(state);
    StateStyleable.onFocus!(state, ctx as WidgetContext<unknown>);
    expect(state.widgetState).toBe('focused');
    StateStyleable.onBlur!(state, ctx as WidgetContext<unknown>);
    expect(state.widgetState).toBe('default');
  });

  test('onBlur does not overwrite disabled / selected', () => {
    const disabled: StateStyleableState = { widgetState: 'disabled' };
    StateStyleable.onBlur!(disabled, mkCtx(disabled) as WidgetContext<unknown>);
    expect(disabled.widgetState).toBe('disabled');

    const selected: StateStyleableState = { widgetState: 'selected' };
    StateStyleable.onBlur!(selected, mkCtx(selected) as WidgetContext<unknown>);
    expect(selected.widgetState).toBe('selected');
  });

  test('factory form produces equivalent behavior', () => {
    const b = stateStyleable<StateStyleableState>({ trackSelected: false });
    const state: StateStyleableState = { widgetState: 'default' };
    b.onFocus!(state, mkCtx(state) as WidgetContext<unknown>);
    expect(state.widgetState).toBe('focused');
  });
});

describe('resolveStyle', () => {
  const styleMap: StateMap<StyleSpec> = {
    default:  { bg: 'surface', fg: 'text' },
    focused:  { bg: 'surface.raised', fg: 'text', border: { style: 'single', color: 'border.focused' } },
    pressed:  { bg: 'pressed.bg', fg: 'pressed.fg' },
  };

  test('picks state-specific entry when present', () => {
    const state: StateStyleableState = { widgetState: 'focused' };
    const resolved = resolveStyle(state, styleMap);
    expect(resolved.bg).toBe('surface.raised');
    expect(resolved.border?.color).toBe('border.focused');
  });

  test('falls back to default when state has no entry', () => {
    const state: StateStyleableState = { widgetState: 'hovered' };
    const resolved = resolveStyle(state, styleMap);
    expect(resolved).toEqual(styleMap.default);
  });

  test('default state → default entry', () => {
    const state: StateStyleableState = { widgetState: 'default' };
    const resolved = resolveStyle(state, styleMap);
    expect(resolved).toEqual(styleMap.default);
  });

  test('exhaustive — every WidgetState resolves to something', () => {
    const allStates: WidgetState[] = [
      'default', 'hovered', 'focused', 'pressed', 'disabled', 'selected',
    ];
    for (const s of allStates) {
      const state: StateStyleableState = { widgetState: s };
      const resolved = resolveStyle(state, styleMap);
      expect(resolved).toBeDefined();
      expect(resolved.bg).toBeDefined();
    }
  });
});
