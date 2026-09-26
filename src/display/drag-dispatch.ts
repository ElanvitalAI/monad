// ─────────────────────────────────────────────────────────────────
// Drag dispatch adapter — Phase DS-2a of PLAN-drag-session-primitive.md
// · joint DS-2 split (PLAN author owns this file · Session B owns
// coordinator wiring + dashboard hook + modalLifecycle subscription).
//
// Single function: bridges `DisplayMouseEvent` from dashboard-mouse-
// wiring to the `DragManager.handleMouse` entrypoint landed in DS-1
// (src/primitives/drag-session/index.ts · PR #315).
//
// Call sequence at runtime
// ─────────────────────────
//   Mouse SGR → dashboard-mouse-wiring
//                │
//                ├─ dragDispatch(ev, coord.dragManagerAPI()) → boolean
//                │     └─ true  → stop (consumed by drag session)
//                │     └─ false → fall through to existing mouse chain
//                │                (mx-mouse / textInput / streaming /
//                │                 routeInputEvent)
//
// What this adapter does
// ───────────────────────
//   1. `ELANOUS_DRAG_DISABLED=1` kill-switch — short-circuits before
//      any manager interaction. Runtime consumers get a clean
//      "completely transparent" fallback path for incident response.
//   2. Inactive session → false. No translation, no log, no cost.
//   3. Non-progressing mouse types (click/scroll/right-click/motion/
//      double-click) → false. Session stays alive but these events
//      fall through so the rest of the mouse chain still sees them
//      (e.g. a right-click during drag remains reachable by whatever
//      surface is under the pointer — user may right-click to abort
//      via a context-menu action down the line).
//   4. drag / release → translate to MouseInputEvent via U-3-prep
//      `buildMouseInputEventFromDisplay` (already handles display
//      HitTarget → input-core HitTarget mapping incl. modal-body /
//      modal-button → unknown degradation, windowId string → number
//      coerce, etc.) then call `manager.handleMouse`.
//
// Non-goals (Phase DS-2a)
// ────────────────────────
//   • Does NOT wire `coord.dragManagerAPI()` — Session B's DS-2b
//     lands that on coordinator.ts.
//   • Does NOT subscribe to `ModalLifecycle.on('mounted')` — Session B
//     lands that in DS-2b with the `typeName.endsWith('-drag-
//     disambiguation')` exception from PLAN §R8.
//   • Does NOT hook key events — ESC cancel is Session A's A-8
//     concern at `src/input-core/dispatcher.ts`.
//   • Does NOT own the mouse-wiring +1 hook line — Session B's DS-2b
//     adds that `if (dragDispatch(ev, coord.dragManagerAPI())) return;`
//     in dashboard-mouse-wiring.ts.
//
// Kill-switch behavior
// ────────────────────
//   Read once at module load — redirects to early return without
//   allocation. Reason for module-level read (vs per-call check):
//   the env var is not intended for mid-session toggling; operators
//   set it when starting a session to opt out of drag entirely.
//   If dynamic toggling is ever required, promote to a getter;
//   callers should not need to adjust.
// ─────────────────────────────────────────────────────────────────

import { isCaptureSessionMouseEventType, type DisplayMouseEvent } from './types.js';
import type { DragManager } from '../primitives/drag-session/index.js';
import { buildMouseInputEventFromDisplay, type BuildMouseOpts } from '../input-core/mouse-bridge.js';
import { debug } from '../debug/log.js';

/** Whether drag dispatch is globally disabled via env flag. Read once
 *  at module load — callers cannot change this mid-session. Exposed
 *  for diagnostics / test introspection (see `isDragDispatchDisabled`). */
const MODULE_ENV_DISABLED = process.env['ELANOUS_DRAG_DISABLED'] === '1';

/** Runtime query — returns whether the `ELANOUS_DRAG_DISABLED` env var
 *  was set at process start. Stable throughout the session. */
export function isDragDispatchDisabled(): boolean {
  return MODULE_ENV_DISABLED;
}

export interface DragDispatchOptions extends BuildMouseOpts {
  /** Override the env-flag kill switch (tests use this · production
   *  should leave undefined and rely on `ELANOUS_DRAG_DISABLED`). */
  readonly forceDisabled?: boolean;
}

/** Route a `DisplayMouseEvent` through the DragManager when a session
 *  is active. Returns true if the event was consumed (caller stops
 *  further routing). Returns false when:
 *    • Drag is disabled (env flag or opts.forceDisabled).
 *    • No session is active.
 *    • Event type is not 'drag' / 'release' (session keeps running
 *      but this event passes through).
 *
 *  The caller — `src/dashboard-mouse-wiring.ts` (Session B DS-2b) —
 *  inserts a single guard line:
 *
 *      if (dragDispatch(ev, coord.dragManagerAPI())) return;
 *
 *  before the existing mouse chain. That's the entire integration. */
export function dragDispatch(
  ev: DisplayMouseEvent,
  manager: DragManager,
  opts?: DragDispatchOptions,
): boolean {
  if (opts?.forceDisabled ?? MODULE_ENV_DISABLED) {
    return false;
  }
  if (!manager.isActive()) {
    return false;
  }

  // Non-progressing mouse types stay in the outer chain so other
  // consumers (e.g. right-click context menu handlers) can still
  // observe them while a drag is underway. This matches vtm's
  // gear capture semantics: only pull/release events are routed
  // via the captured path.
  if (!isCaptureSessionMouseEventType(ev.type)) {
    if (debug.enabled) {
      debug.log('mouse.drag.route', 'passthrough-non-progressing', {
        type: ev.type,
        row: ev.row,
        col: ev.col,
        hit: ev.hitTarget?.kind ?? null,
      });
    }
    return false;
  }

  const inputEv = buildMouseInputEventFromDisplay(ev, opts);

  if (debug.enabled) {
    debug.log('mouse.drag.intercept', ev.type, {
      row: ev.row,
      col: ev.col,
      hit: inputEv.target.kind,
      source: manager.current()?.source ?? null,
    });
  }

  const consumed = manager.handleMouse(inputEv, inputEv.target);

  if (debug.enabled) {
    debug.log('mouse.drag.route', consumed ? 'consumed' : 'passthrough', {
      type: ev.type,
      row: ev.row,
      col: ev.col,
    });
  }

  return consumed;
}
