// Scrollable — vim-style scroll keys on a state with a `scroll: number`
// field. Phase 2 of the widget-arch refactor.
//
// Keys:
//   j / ↓           scroll += 1
//   k / ↑           scroll -= 1
//   g / Home        scroll = 0
//   G / End         scroll = maxScroll (if present)
//   PgDn            scroll += pageSize
//   PgUp            scroll -= pageSize
//   Ctrl+d          scroll += halfPage
//   Ctrl+u          scroll -= halfPage
//
// State contract: the widget's state must have `scroll: number`. It may
// optionally have `maxScroll?: number` (for G/End clamping) and
// `pageSize?: number` (default 10) and `halfPageSize?: number` (default
// 5). `maxScroll` absent → G/End no-ops.

import type { KeyEvent, Action, WidgetContext } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

export interface ScrollableState {
  scroll: number;
  maxScroll?: number;
  pageSize?: number;
  halfPageSize?: number;
}

export interface ScrollableConfig {
  /** Default 10 — rows per PgUp/PgDn jump. Overridden by state.pageSize. */
  pageSize?: number;
  /** Default 5 — rows per Ctrl+d/u jump. Overridden by state.halfPageSize. */
  halfPageSize?: number;
}

const SCROLL_KEYS = new Set([
  'j', 'k', 'down', 'up',
  'g', 'G', 'home', 'end',
  'pageup', 'pagedown',
]);

function handlesKey<S extends ScrollableState>(key: KeyEvent, _state: S): boolean {
  if (SCROLL_KEYS.has(key.name)) return true;
  // Ctrl+d / Ctrl+u
  if (key.ctrl && (key.name === 'd' || key.name === 'u')) return true;
  return false;
}

function onKey<S extends ScrollableState>(
  key: KeyEvent,
  state: S,
  _ctx: WidgetContext<S>,
  config: Required<ScrollableConfig>,
): Action {
  const page = state.pageSize ?? config.pageSize;
  const half = state.halfPageSize ?? config.halfPageSize;
  const max = state.maxScroll;
  const clamp = (n: number) => {
    const lo = Math.max(0, n);
    return max !== undefined ? Math.min(max, lo) : lo;
  };

  switch (key.name) {
    case 'j': case 'down':
      state.scroll = clamp(state.scroll + 1); break;
    case 'k': case 'up':
      state.scroll = clamp(state.scroll - 1); break;
    case 'g': case 'home':
      state.scroll = 0; break;
    case 'G': case 'end':
      if (max !== undefined) state.scroll = max; break;
    case 'pagedown':
      state.scroll = clamp(state.scroll + page); break;
    case 'pageup':
      state.scroll = clamp(state.scroll - page); break;
    case 'd':
      if (key.ctrl) state.scroll = clamp(state.scroll + half); break;
    case 'u':
      if (key.ctrl) state.scroll = clamp(state.scroll - half); break;
  }
  return { type: 'refresh' };
}

export function scrollable<S extends ScrollableState>(
  config: ScrollableConfig = {},
): WidgetBehavior<S> {
  const merged: Required<ScrollableConfig> = {
    pageSize: config.pageSize ?? 10,
    halfPageSize: config.halfPageSize ?? 5,
  };
  return {
    name: 'scrollable',
    handlesKey,
    onKey: (key, state, ctx) => onKey(key, state, ctx, merged),
  };
}

/** Default-configured Scrollable instance — a widget can just declare
 *  `behaviors: [Scrollable]` without a factory call when it's happy
 *  with page=10 / halfPage=5. */
export const Scrollable: WidgetBehavior<ScrollableState> = scrollable();
