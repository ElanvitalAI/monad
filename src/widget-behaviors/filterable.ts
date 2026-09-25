// Filterable — `/` starts filter input, Esc cancels.
//
// This is the *entry* behavior for filter mode. Phase 2 widgets that
// adopt it gain a toggle into a filtering state; the actual character-
// by-character buffer editing (backspace, etc.) happens inside the
// widget's own onKey once `state.filtering === true`, because every
// widget's filter input has slightly different semantics (search-on-
// type vs search-on-Enter, multi-buffer vs single, etc.).
//
// Keys (only when `state.filtering === false`):
//   /    state.filtering = true;  state.filter = ''
// Keys (only when `state.filtering === true`):
//   Esc  state.filtering = false; state.filter = ''
//
// All other keys pass through — widget-specific onKey handles them.

import type { KeyEvent, Action, WidgetContext } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

export interface FilterableState {
  filter: string;
  filtering: boolean;
}

export interface FilterableConfig<S extends FilterableState = FilterableState> {
  /** Called just after entering filter mode. Useful for focus steal. */
  onEnter?: (state: S, ctx: WidgetContext<S>) => void;
  /** Called just after leaving filter mode (Esc). */
  onExit?: (state: S, ctx: WidgetContext<S>) => void;
}

export function filterable<S extends FilterableState>(
  config: FilterableConfig<S> = {},
): WidgetBehavior<S> {
  return {
    name: 'filterable',
    handlesKey: (key, state) => {
      if (key.ctrl || key.shift) return false;
      if (!state.filtering && key.name === '/') return true;
      if (state.filtering && key.name === 'escape') return true;
      return false;
    },
    onKey: (key, state, ctx): Action => {
      if (!state.filtering && key.name === '/') {
        state.filtering = true;
        state.filter = '';
        config.onEnter?.(state, ctx);
        return { type: 'refresh' };
      }
      if (state.filtering && key.name === 'escape') {
        state.filtering = false;
        state.filter = '';
        config.onExit?.(state, ctx);
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
  };
}

/** Default-configured Filterable — no callbacks. */
export const Filterable: WidgetBehavior<FilterableState> = filterable();
