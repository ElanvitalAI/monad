// PaneNavigable — h/l keys that navigate to sibling panes. Factory
// takes explicit `onLeft` / `onRight` handlers because TUI panes have
// heterogeneous neighbors (e.g. agent-detail's `l` jumps to preview,
// but agent-log's `l` jumps to log).
//
// Keys:
//   h (or ←)   onLeft?(state, ctx)
//   l (or →)   onRight?(state, ctx)
//
// Absent handlers make the corresponding key a no-op — widgets declare
// only the direction that makes sense.

import type { KeyEvent, Action, WidgetContext } from '../widgets/types.js';
import type { WidgetBehavior } from './types.js';

export interface PaneNavigableConfig<S = unknown> {
  onLeft?: (state: S, ctx: WidgetContext<S>) => void;
  onRight?: (state: S, ctx: WidgetContext<S>) => void;
  /** Set true if the widget wants ← / → to also trigger pane nav.
   *  Default false — arrows usually drive cursor/scroll within the
   *  pane, leaving h/l for explicit lateral motion. */
  arrowsAsNav?: boolean;
}

function makeBehavior<S>(cfg: PaneNavigableConfig<S>): WidgetBehavior<S> {
  return {
    name: 'pane-navigable',
    handlesKey: (key) => {
      if (key.ctrl || key.shift) return false;
      if (key.name === 'h' || key.name === 'l') return true;
      if (cfg.arrowsAsNav && (key.name === 'left' || key.name === 'right')) return true;
      return false;
    },
    onKey: (key, state, ctx): Action => {
      const goLeft = key.name === 'h' || (cfg.arrowsAsNav && key.name === 'left');
      const goRight = key.name === 'l' || (cfg.arrowsAsNav && key.name === 'right');
      if (goLeft && cfg.onLeft) {
        cfg.onLeft(state, ctx);
        return { type: 'refresh' };
      }
      if (goRight && cfg.onRight) {
        cfg.onRight(state, ctx);
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
  };
}

export function paneNavigable<S>(config: PaneNavigableConfig<S> = {}): WidgetBehavior<S> {
  return makeBehavior(config);
}
