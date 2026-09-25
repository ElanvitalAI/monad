// Cursorable — vim-style cursor navigation on a state with a
// `cursor: number` field and a way to report the total item count.
//
// Keys:
//   j / ↓           cursor += 1  (clamped to itemCount - 1)
//   k / ↑           cursor -= 1  (clamped to 0)
//   g / Home        cursor = 0
//   G / End         cursor = itemCount - 1
//
// State contract: `cursor: number`. Item count can come from either
// `state.itemCount: number` or a `getItemCount` injector — the latter
// keeps widgets whose items live outside state (e.g. agent-roster
// reading from the registry) honest.

import type { KeyEvent, Action, WidgetContext } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

export interface CursorableState {
  cursor: number;
  itemCount?: number;
}

export interface CursorableConfig<S extends CursorableState> {
  /** Called on every onKey to learn how many items exist. Takes
   *  precedence over state.itemCount. Return 0 or negative to disable. */
  getItemCount?: (state: S) => number;
}

const CURSOR_KEYS = new Set([
  'j', 'k', 'down', 'up',
  'g', 'G', 'home', 'end',
]);

function resolveCount<S extends CursorableState>(
  state: S,
  cfg: CursorableConfig<S>,
): number {
  if (cfg.getItemCount) return Math.max(0, cfg.getItemCount(state));
  return Math.max(0, state.itemCount ?? 0);
}

function handlesKey(key: KeyEvent): boolean {
  return CURSOR_KEYS.has(key.name);
}

function onKey<S extends CursorableState>(
  key: KeyEvent,
  state: S,
  _ctx: WidgetContext<S>,
  cfg: CursorableConfig<S>,
): Action {
  const count = resolveCount(state, cfg);
  if (count === 0) return { type: 'none' };
  const max = count - 1;
  const clamp = (n: number) => Math.max(0, Math.min(max, n));

  switch (key.name) {
    case 'j': case 'down':
      state.cursor = clamp(state.cursor + 1); break;
    case 'k': case 'up':
      state.cursor = clamp(state.cursor - 1); break;
    case 'g': case 'home':
      state.cursor = 0; break;
    case 'G': case 'end':
      state.cursor = max; break;
  }
  return { type: 'refresh' };
}

export function cursorable<S extends CursorableState>(
  config: CursorableConfig<S> = {},
): WidgetBehavior<S> {
  return {
    name: 'cursorable',
    handlesKey: (key) => handlesKey(key),
    onKey: (key, state, ctx) => onKey(key, state, ctx, config),
  };
}

/** Default-configured Cursorable — reads state.itemCount. Widgets
 *  that need a getItemCount injector use the factory instead. */
export const Cursorable: WidgetBehavior<CursorableState> = cursorable();
