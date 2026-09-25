// Shared pane-click dispatch — extracted from dashboard.ts mx-mouse
// branch so input-mode onMouse can reuse the same hit-test + focus
// + widget-forwarding logic. Without this helper, either (a) the
// logic gets duplicated across the two call sites and drifts, or
// (b) input-mode silently drops pane-body click/scroll events
// (the current pre-Phase-3 state — see PLAN-session-mouse-diag-fix
// M2 re-land notes and 내부 문서 `PLAN-session-idx-5-phase-3` §0.2).
//
// Design:
//   - Pure input/output. Side effects (focus mutation, submit
//     dispatch) are reached through the callback deps the caller
//     provides; the helper itself only decides *what* happened.
//   - Discriminated outcome lets each caller map to its own contract
//     (mx-mouse returns 'consumed'|'passthrough' for the keyDispatch
//     chain; textInput.onMouse returns void and calls draw()).
//   - Covers click / double-click / scroll-up / scroll-down. Other
//     event types (drag, release, right-click, motion) return
//     'no-hit' — they have their own routing paths.

import type { Layout } from '../layout/types.js';
import {
  isPrimaryDiscreteClickMouseEventType,
  type DisplayMouseEvent,
} from './types.js';
import { hitTestLayoutCell } from '../layout/render.js';

/** Mouse event types that route through a pane cell to the widget.
 *  Matches the subset widget `onMouse` handlers accept
 *  (`widget-types.ts::WidgetDef.onMouse`).
 *
 *  Bundle 1 P2 (2026-04-20) added `drag` / `release` to the routing —
 *  sketch-style widgets (IUL Canvas) need the full press → drag →
 *  release lifecycle. The press event is `click` (the SGR parser
 *  doesn't emit a separate `mouse-down`; the widget treats `click` as
 *  the down event and waits for `release` to finalize). Right-click /
 *  motion still have their own dispatch paths and never reach a
 *  widget via this helper. */
export type WidgetMouseType =
  | 'click'
  | 'double-click'
  | 'scroll-up'
  | 'scroll-down'
  | 'drag'
  | 'release';

/** Result of dispatching a pane click. Callers map this to their
 *  own return contract. */
export type PaneClickOutcome =
  /** Event was not in the grid area, the layout is unset, the grid
   *  zone is uninitialized, or the event type isn't one we handle. */
  | { kind: 'no-hit' }
  /** Hit a pane cell. If the event is click/double-click, `focusPane`
   *  identifies which pane received focus (caller decides whether to
   *  apply it). Widget has no onMouse — caller should still consume
   *  the click (focus changed) or pass through for scroll. */
  | { kind: 'focus-only'; focusPane: string | null; widgetInstanceId: string }
  /** Hit a pane cell and the widget's onMouse was invoked. If it
   *  returned a submit action, `submitText` carries it for the caller
   *  to dispatch. */
  | { kind: 'widget-handled'; focusPane: string | null; submitText: string | null; widgetInstanceId: string };

/** Callback surface the helper needs to hit-test and forward to
 *  widgets. All callbacks are pure lookups except `invokeWidgetMouse`
 *  which runs the widget's onMouse and returns its submit text (if
 *  the widget returned a submit action) or null. */
export interface PaneClickDispatchDeps {
  /** Currently-rendered layout tree; null when the dashboard hasn't
   *  drawn its first frame. */
  layout: Layout | null;
  /** Row (1-indexed) where the grid area starts, or null when grid
   *  is unrendered (e.g. dashboard collapsed). */
  gridZoneStart: number | null;
  /** Height in rows of the grid area, or null. */
  gridZoneHeight: number | null;
  /** Terminal column count at event time. */
  termCols: number;
  /** Map a widget instance id to a pane focus name, or null when the
   *  widget isn't tied to a focusable pane (plugin panes, etc.). */
  paneFocusForWidgetInstanceId: (widgetInstanceId: string) => string | null;
  /** Invoke widget.onMouse with local coords. Returns the widget's
   *  submit text if it produced a submit action, null otherwise.
   *  Callers wrap the widget's onMouse call in their own try/catch —
   *  errors propagate here so the helper stays pure. */
  invokeWidgetMouse: (
    widgetInstanceId: string,
    type: WidgetMouseType,
    localRow: number,
    localCol: number,
  ) => { kind: 'none' } | { kind: 'submit'; text: string } | { kind: 'no-handler' };
}

/** Decide whether a mouse event lands on a pane cell and what the
 *  downstream effect should be. Pure — side effects (focus mutation,
 *  submit dispatch) stay with the caller. */
export function dispatchPaneClick(
  m: DisplayMouseEvent,
  deps: PaneClickDispatchDeps,
): PaneClickOutcome {
  // Click / double-click / scroll / drag / release all route through
  // the pane cell to the widget when one is present. Right-click /
  // motion still have their own paths in the caller.
  if (
    m.type !== 'click'
    && m.type !== 'double-click'
    && m.type !== 'scroll-up'
    && m.type !== 'scroll-down'
    && m.type !== 'drag'
    && m.type !== 'release'
  ) {
    return { kind: 'no-hit' };
  }

  const { layout, gridZoneStart, gridZoneHeight, termCols } = deps;
  if (
    !layout
    || gridZoneStart === null
    || gridZoneHeight === null
    || m.row < gridZoneStart
    || m.row >= gridZoneStart + gridZoneHeight
  ) {
    return { kind: 'no-hit' };
  }

  const hit = hitTestLayoutCell(
    layout,
    { width: termCols, height: gridZoneHeight, topRow: gridZoneStart },
    m.row,
    m.col,
  );
  if (!hit) return { kind: 'no-hit' };

  // Resolve focus target. Scroll / drag / release / mouse-down don't
  // shift focus — the user is either navigating within a pane without
  // committing to it (scroll), or already actively interacting
  // (mouse-down/drag/release should leave focus where mouse-down
  // first put it). Click and double-click are the focus-shifting
  // events.
  const focusPane: string | null =
    isPrimaryDiscreteClickMouseEventType(m.type)
      ? deps.paneFocusForWidgetInstanceId(hit.widgetInstanceId)
      : null;

  // m.type is narrowed to WidgetMouseType by the guard at the top of
  // this function — drag/release/right-click/motion all return
  // 'no-hit' before reaching here.
  const widgetResult = deps.invokeWidgetMouse(
    hit.widgetInstanceId,
    m.type as WidgetMouseType,
    hit.localRow,
    hit.localCol,
  );

  if (widgetResult.kind === 'no-handler') {
    return { kind: 'focus-only', focusPane, widgetInstanceId: hit.widgetInstanceId };
  }

  return {
    kind: 'widget-handled',
    focusPane,
    submitText: widgetResult.kind === 'submit' ? widgetResult.text : null,
    widgetInstanceId: hit.widgetInstanceId,
  };
}
