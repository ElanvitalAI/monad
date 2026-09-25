// Selectable — multi-select with space (toggle cursor) and A (toggle
// all). State keeps a Set<string> of selected ids.
//
// Keys:
//   space   toggle selection at cursor
//   A       toggle-all — select all if any unselected, else clear
//
// Config must supply:
//   getItemIds(state) → readonly string[]    all visible item ids
//   getCursorId(state) → string | undefined  id at the cursor row
// The widget's state must have `selected: Set<string>`. The behavior
// mutates it in place.

import type { KeyEvent, Action, WidgetContext } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

export interface SelectableState {
  selected: Set<string>;
}

export interface SelectableConfig<S extends SelectableState> {
  getItemIds: (state: S) => readonly string[];
  getCursorId: (state: S) => string | undefined;
  /** Called after a single-item toggle. */
  onToggle?: (id: string, nowSelected: boolean, state: S, ctx: WidgetContext<S>) => void;
  /** Called after toggle-all. */
  onToggleAll?: (nowSelected: boolean, state: S, ctx: WidgetContext<S>) => void;
}

export function selectable<S extends SelectableState>(
  config: SelectableConfig<S>,
): WidgetBehavior<S> {
  return {
    name: 'selectable',
    handlesKey: (key) => {
      if (key.ctrl) return false;
      return key.name === 'space' || key.name === 'A';
    },
    onKey: (key, state, ctx): Action => {
      if (key.name === 'space') {
        const id = config.getCursorId(state);
        if (id === undefined) return { type: 'none' };
        if (state.selected.has(id)) {
          state.selected.delete(id);
          config.onToggle?.(id, false, state, ctx);
        } else {
          state.selected.add(id);
          config.onToggle?.(id, true, state, ctx);
        }
        return { type: 'refresh' };
      }
      if (key.name === 'A') {
        const ids = config.getItemIds(state);
        if (ids.length === 0) return { type: 'none' };
        // If every item is selected, A clears. Otherwise A selects all.
        const allSelected = ids.every((id) => state.selected.has(id));
        if (allSelected) {
          state.selected.clear();
          config.onToggleAll?.(false, state, ctx);
        } else {
          for (const id of ids) state.selected.add(id);
          config.onToggleAll?.(true, state, ctx);
        }
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
  };
}
