// StateStyleable — tracks the current WidgetState on the widget's
// state object and provides a resolver for StateMap<StyleSpec>.
//
// State contract: the widget's state has `widgetState: WidgetState`.
// The behavior's onFocus/onBlur hooks update it to 'focused' / 'default'
// respectively. Hover/pressed/disabled/selected transitions come from
// other sources (mouse events, explicit widget API calls) — the
// behavior accepts them as imperative setters via the returned helper
// (not exposed here; Phase 3 widgets wire via their own API).
//
// The render-time resolver `resolveStyle(state, map)` returns the
// StyleSpec for the current widgetState, falling back to `map.default`.
// It's exported as a free function rather than an onBehavior method
// because render is pure; behaviors only own keys/lifecycle.

import type { WidgetState, StateMap, StyleSpec } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

/** State contract for widgets adopting StateStyleable. */
export interface StateStyleableState {
  widgetState: WidgetState;
}

/** Free function — pick the right StyleSpec for `state.widgetState`,
 *  falling back to `map.default`. Used in render(). */
export function resolveStyle<S extends StateStyleableState>(
  state: S,
  map: StateMap<StyleSpec>,
): StyleSpec {
  const current = map[state.widgetState];
  return current ?? map.default;
}

export interface StateStyleableConfig {
  /** If true, StateStyleable tracks 'selected' via the behavior's
   *  toggle helpers. Default false — most widgets prefer explicit
   *  control. (Not wired in Phase 2; placeholder for Phase 3/4.) */
  trackSelected?: boolean;
}

export function stateStyleable<S extends StateStyleableState>(
  _config: StateStyleableConfig = {},
): WidgetBehavior<S> {
  return {
    name: 'state-styleable',
    onMount(state, _ctx) {
      // Ensure the state has a valid widgetState — widgets that
      // forget to initialize it get 'default' for free.
      // TypeScript doesn't know `widgetState` is required at construct
      // time, so guard at runtime.
      if (state.widgetState === undefined) {
        state.widgetState = 'default' as WidgetState;
      }
    },
    onFocus(state, _ctx) {
      state.widgetState = 'focused';
    },
    onBlur(state, _ctx) {
      // Don't overwrite disabled/selected on blur — only reset focused.
      if (state.widgetState === 'focused') {
        state.widgetState = 'default';
      }
    },
  };
}

/** Default StateStyleable — focus/blur tracking only. */
export const StateStyleable: WidgetBehavior<StateStyleableState> = stateStyleable();
