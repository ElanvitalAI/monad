// ─────────────────────────────────────────────────────────────────
// Working-dir browser pane drag source — DS-3a (PLAN-drag-session-
// ds3-browser-to-chat §3.3).
//
// Role
// ────
//   Listens to DisplayMouseEvent on the browser pane and, when the
//   user crosses the drag threshold (vtm `drag_threshold` pattern),
//   calls `manager.begin(...)` with a multi-format payload built
//   from `WorkingDirState.selected` (or the cursor entry as fallback).
//   After begin, subsequent drag/release events are routed by
//   DS-2a's drag-dispatch adapter into `manager.handleMouse`; this
//   module only handles the "source → begin" transition.
//
// Threshold model
// ───────────────
//   Terminal mouse events (SGR 1006) arrive as `drag` type whenever
//   the pointer moves while a button is held. We capture the FIRST
//   drag event as the reference point (`pressAt`) and begin the
//   session on a SUBSEQUENT drag when Manhattan distance exceeds
//   `threshold` (default 2 cells). This matches vtm's pattern of
//   suppressing jittery click-moves from spuriously starting drags.
//
// Payload shape (multi-format · PLAN §1.1 · Qt QMimeData precedent)
// ──────────────────────────────────────────────────────────────────
//   'file-path[]'        — monad-native array of absolute paths
//   'text/uri-list'      — RFC 2483 `file://` URIs, one per line
//   'llm-context-slice'  — structured hint for LLM context dump
//                          (DS-4c target · DS-3a registers but no
//                          consumer reads it yet)
//
// Non-goals (DS-3a)
// ─────────────────
//   • Scroll-wheel drag (session stays alive on scroll via DS-2a
//     passthrough; this module doesn't react).
//   • Right-click drag (button check only accepts 'left').
//   • Remote browser mode (`state.remote`) — absolute paths are
//     local-fs only; remote paths would need a different payload
//     shape. DS-4 scope.

import type {
  DragManager,
  DragHandle,
} from '../primitives/drag-session/index.js';
import {
  payload as buildPayload,
} from '../primitives/drag-session/index.js';
import {
  isPreCaptureResetMouseEventType,
  type DisplayMouseEvent,
  type HitTarget,
  type SurfaceId,
} from '../display/types.js';
import type { BrowserPaneModel } from '../browser-pane/model.js';
import { debug } from '../debug/log.js';

export interface BindWorkingDirDragSourceOpts {
  readonly manager: DragManager;
  /** Mutable reference to the working-dir state. Read synchronously
   *  at `begin` time so the payload captures the exact selection /
   *  cursor at the instant the user crossed the threshold. */
  readonly state: BrowserPaneModel;
  /** SurfaceId to record on the DragSession. Convention:
   *  `'pane:browser' as SurfaceId`. */
  readonly surfaceId: SurfaceId;
  /** Cells — default 2. vtm's `drag_threshold` analogue. */
  readonly threshold?: number;
  /** Production paneId the browser widget reports in HitTarget.
   *  Dashboard spawns with `id: 'wd-browser'` (dashboard.ts:5300)
   *  and `getPaneHitTarget` propagates that as `paneId` — so real
   *  hits arrive as `{kind:'pane-body', paneId:'wd-browser'}`.
   *  Pre-2026-04-22 this module hardcoded `'browser'` → isBrowserHit
   *  always returned false in production → drag never began. Bug
   *  confirmed via debug-20260421172740.log (158 drag events
   *  arrived · 0 drag-session.begin emissions) during the first
   *  actual manual QA after 5 PRs merged the DS + CMX arcs.
   *
   *  Default matches production; test fixtures using `'browser'`
   *  must pass the same string explicitly here. */
  readonly paneId?: string;
}

export interface WorkingDirDragSource {
  /** Call from dashboard's mouse event pipeline AFTER
   *  `mouseWiring.handleMouse(ev)` has attached `ev.hitTarget`. Returns
   *  true when a drag session was begun on this call (so the caller
   *  can skip further processing if desired; usually the caller
   *  ignores the return value since the DragManager is now active
   *  and DS-2a adapter will handle subsequent drag/release). */
  onMouse(ev: DisplayMouseEvent): boolean;
  /** Reset internal state. Called when the source wants to
   *  invalidate an in-progress threshold (e.g. pane focus lost,
   *  working-dir state refreshed mid-gesture). Idempotent. */
  reset(): void;
  /** Release listener resources. Currently a no-op — kept for
   *  symmetry with modal-lifecycle disposers so dashboard can wire
   *  it into the same cleanup list. */
  dispose(): void;
}

const DEFAULT_THRESHOLD = 2;
const DEFAULT_BROWSER_PANE_ID = 'wd-browser';

export function bindWorkingDirDragSource(
  opts: BindWorkingDirDragSourceOpts,
): WorkingDirDragSource {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const browserPaneId = opts.paneId ?? DEFAULT_BROWSER_PANE_ID;

  // Reference point captured on the first `drag` event of each
  // potential gesture. Null between gestures.
  let pressAt: { readonly row: number; readonly col: number } | null = null;
  // HitTarget snapshotted at the same moment as `pressAt`. Used at
  // threshold-crossing time to derive the payload from the *press*
  // location rather than the current (already-moved) cursor position.
  // Pre-fix this field didn't exist and `snapshotPaths(ev)` read the
  // threshold-crossing event's hit — by then the cursor had moved
  // ≥ threshold cells past the press point, so the payload picked the
  // file 2-3 rows below the one the user clicked on (systematic
  // off-by-threshold bug observed in 2026-04-22 QA).
  let pressHit: HitTarget | null = null;
  // Once begin() fires for a gesture, we stop evaluating threshold
  // until the next release. `ownedHandle` tracks the session so
  // `reset()` can programmatically cancel it.
  let ownedHandle: DragHandle | null = null;

  const resetGesture = (): void => {
    pressAt = null;
    pressHit = null;
    ownedHandle = null;
  };

  const isBrowserHit = (ev: DisplayMouseEvent): boolean => {
    const h = ev.hitTarget;
    if (!h) return false;
    if (h.kind !== 'pane-body' && h.kind !== 'pane-title') return false;
    return h.paneId === browserPaneId;
  };

  const snapshotPaths = (hit: HitTarget | null): readonly string[] => {
    // Prefer explicit selection (multi-select via Space).
    if (opts.state.selected.size > 0) {
      return [...opts.state.selected];
    }
    // IDX-F5d (2026-04-22) — prefer the entry under the mouse pointer
    // to the keyboard-nav cursor. Before F5d the snapshot used
    // `state.cursor`, which is the keyboard-nav selection — meaning
    // mouse drag would capture "whatever the last arrow-key landed
    // on", regardless of the row the pointer actually sat on. The
    // wiring layer now decorates the `pane-body` HitTarget with
    // `hit: {kind:'list-row', itemIndex}` via `Widget.describeHit`
    // (list widget adoption · 2026-04-22), so we read the pointer's
    // own target first and only fall back to state.cursor when the
    // HitTarget wasn't classified (bare click on title row, tests,
    // non-list widget paneId mismatch).
    //
    // 2026-04-22b (bug-drag-snapshot-timing): the hit passed in here
    // is the *press-time* hit (captured with pressAt on the first
    // drag event), not the threshold-crossing hit. By threshold time
    // the cursor has already moved `threshold` cells past the press
    // point, so reading the threshold-event's hit resolved to the
    // file 2-3 rows below the one the user actually clicked on.
    const pointerIdx =
      hit && hit.kind === 'pane-body' && hit.hit?.kind === 'list-row'
        ? hit.hit.itemIndex
        : null;
    const idx = pointerIdx ?? opts.state.cursor;
    // Fallback: single file under the resolved index. Folders
    // (including `..`) are not draggable — return empty to skip
    // begin().
    const entry = opts.state.entries[idx];
    if (!entry || entry.isDir) return [];
    return [entry.absPath];
  };

  const onMouse = (ev: DisplayMouseEvent): boolean => {
    // Release / click (complete press+release) ends the gesture
    // whether or not begin() fired. Non-left buttons never begin.
    if (isPreCaptureResetMouseEventType(ev.type)) {
      resetGesture();
      return false;
    }

    // We only care about drag events over the browser pane while no
    // session is active (DS-2a adapter intercepts drag when active).
    if (ev.type !== 'drag') return false;
    if (!isBrowserHit(ev)) {
      // Pointer strayed off browser before crossing threshold —
      // abandon the gesture. Don't touch `ownedHandle` because
      // DS-2a keeps routing to the DragManager once a session is
      // active; cross-surface pointer travel is the expected
      // behavior.
      //
      // CLAUDE.md debug instrumentation: rejection is the critical
      // junction to log — "why did drag ignore my mouse?" triage
      // needs to tell apart (a) wire not running, (b) paneId mismatch
      // (cf. #399), (c) pointer genuinely off-pane. Gate the whole
      // snapshot build so off-state is zero-cost; rejection frequency
      // is bounded (only fires when pointer wanders off during a
      // press-held gesture, not on every drag tick inside the pane).
      if (debug.enabled) {
        const h = ev.hitTarget;
        debug.log('working-dir-mouse.reject', 'not-browser-hit', {
          type: ev.type,
          row: ev.row,
          col: ev.col,
          hitKind: h?.kind ?? '(none)',
          hitPaneId: h && (h.kind === 'pane-body' || h.kind === 'pane-title' || h.kind === 'pane-nav-tab') ? h.paneId : '(n/a)',
          browserPaneId,
          ownedHandleActive: ownedHandle !== null,
        });
      }
      if (ownedHandle === null) pressAt = null;
      return false;
    }
    if (ownedHandle !== null) {
      // Already in an active session from an earlier call. DS-2a
      // adapter handles this drag event at the wiring layer; we
      // should not be invoked again for it, but if dashboard does
      // call us (defensive), just report no new begin.
      return false;
    }
    if (pressAt === null) {
      // First drag event of the gesture — establish reference point.
      // Also snapshot the HitTarget at this moment so threshold-
      // crossing later uses the press-time hit (see pressHit doc above).
      pressAt = { row: ev.row, col: ev.col };
      pressHit = ev.hitTarget ?? null;
      return false;
    }
    // Subsequent drag — check threshold.
    const dx = Math.abs(ev.col - pressAt.col);
    const dy = Math.abs(ev.row - pressAt.row);
    if (dx + dy < threshold) return false;

    // Threshold crossed. Snapshot the payload from the PRESS-TIME
    // hit (pressHit), not from the current event — see pressHit doc.
    const paths = snapshotPaths(pressHit);
    if (paths.length === 0) {
      // Nothing draggable (no selection, cursor on folder, empty
      // listing). Mark the gesture as "consumed" so we don't keep
      // re-checking on every pull until release.
      //
      // CLAUDE.md debug instrumentation: threshold-crossed-but-no-
      // payload is a rare event (only when user tries to drag a
      // folder / empty pane) but the "silent no-op" UX is confusing
      // enough that forensic value pays the guarded snapshot. Reads
      // both the press-time hit.itemIndex (authoritative post-fix)
      // and the fallback state.cursor so the log tells the full
      // story of which index was consulted and why it resolved to
      // nothing.
      if (debug.enabled) {
        const hitIdx =
          pressHit?.kind === 'pane-body' && pressHit.hit?.kind === 'list-row'
            ? pressHit.hit.itemIndex
            : null;
        const resolvedIdx = hitIdx ?? opts.state.cursor;
        const entry = opts.state.entries[resolvedIdx];
        debug.log('working-dir-mouse.reject', 'empty-paths', {
          selectedSize: opts.state.selected.size,
          hitItemIndex: hitIdx,
          cursorIdx: opts.state.cursor,
          resolvedIdx,
          resolvedName: entry?.name ?? '(none)',
          resolvedIsDir: entry?.isDir ?? null,
          entriesCount: opts.state.entries.length,
        });
      }
      ownedHandle = null;
      // Re-baseline · user may shift selection mid-motion in a future
      // refinement. Re-capture pressHit too so the next attempt uses
      // the current pointer location as the new press reference.
      pressAt = { row: ev.row, col: ev.col };
      pressHit = ev.hitTarget ?? null;
      return false;
    }

    const label = paths.length === 1
      ? pathBasename(paths[0]!)
      : `${paths.length} files`;
    const uriList = paths
      .map((p) => `file://${encodeURI(p)}`)
      .join('\r\n');

    ownedHandle = opts.manager.begin({
      source: opts.surfaceId,
      button: 'left',
      payload: buildPayload(
        [
          ['file-path[]', paths],
          ['text/uri-list', uriList],
          ['llm-context-slice', { kind: 'files', paths }],
        ],
        { label, icon: '📄' },
      ),
      startAt: pressAt,
    });

    // After begin, DS-2a adapter will route subsequent drag/release
    // events to `manager.handleMouse` — we don't see them here
    // again unless dashboard routes us before the adapter.
    return true;
  };

  return {
    onMouse,
    reset: () => {
      if (ownedHandle !== null) {
        try { ownedHandle.cancel('source-reset'); }
        catch { /* swallow */ }
      }
      resetGesture();
    },
    dispose: () => {
      // No resources to release — `manager.begin` created handles
      // are owned by DragManager and cancelled via its own lifecycle
      // (modal push, ESC, etc.).
    },
  };
}

function pathBasename(p: string): string {
  // Portable basename — works for both POSIX and rare Windows-like
  // paths arriving via future cross-process sources.
  const slash = p.lastIndexOf('/');
  const back = p.lastIndexOf('\\');
  const idx = Math.max(slash, back);
  return idx >= 0 ? p.slice(idx + 1) : p;
}
