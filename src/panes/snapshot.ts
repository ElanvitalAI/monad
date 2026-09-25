// ── VW-term-infra Phase 2b — PaneSnapshot contract ──
//
// Point-in-time snapshot of a pane. Feeds capture engine (Screenshot
// · InspectPane · ComparePanes tools), replay / asciicast record,
// and future Ghost Preview / Artifact browser widgets.
//
// Phase 2b status — CONTRACT ONLY:
// This file defines types; per-kind snapshot() implementations land
// in the pane class bodies. Terminal / external-terminal implement
// via PreviewTerminal.serialize() / renderForLLM(). Widget panes
// implement via their render() + cell grid builder (Phase 2b step 2).
// Placeholder panes return a zero-cell snapshot.
//
// See: 내부 문서 `PLAN-session-vw-term-infra` §4 Layer B
//      내부 문서 `PLAN-session-vw-term-infra-p0-p2` §5
//      내부 문서 `PLAN-session-capture-phase-2` §5 (LLM self-trigger tools
//      that consume snapshots)

import type { Rect } from '../display/rect.js';
import type { PaneKind, PaneRef } from './types.js';

/** What callers want from snapshot(). */
export interface SnapshotOpts {
  /** Include scrollback above the current viewport. Default false
   *  — only the visible cell grid. */
  readonly includeScrollback?: boolean;

  /** Preferred output format. Panes may downgrade (e.g. widget pane
   *  that has no ANSI but can produce text). Default: 'cells'. */
  readonly format?: 'cells' | 'ansi' | 'text';
}

/** One cell in the snapshot grid. Matches PreviewTerminal's cell
 *  format intentionally — terminal panes snapshot via the xterm
 *  buffer, widget panes build the equivalent grid from their render
 *  output. SGR attributes are serialized as the SGR string the
 *  emulator would emit (no object shape here — keeps the type free
 *  of presentation concerns and matches cellSgr()). */
export interface ANSICell {
  /** Rendered glyph (may be wide — check getWidth() downstream). */
  readonly glyph: string;
  /** SGR escape prefix to switch to this cell's style — '' when
   *  the cell has default attributes. */
  readonly sgr: string;
  /** Cell width in columns: 0 (trailing of wide), 1 (narrow), 2
   *  (wide/CJK). */
  readonly width: 0 | 1 | 2;
}

/** The snapshot itself. `cells` / `ansi` / `text` are mutually
 *  populated according to `opts.format`; meta is always present. */
export interface PaneSnapshot {
  readonly ref: PaneRef;
  readonly kind: PaneKind;
  readonly capturedAt: number;
  readonly dims: Rect;

  /** Present when `format === 'cells'`. */
  readonly cells?: readonly (readonly ANSICell[])[];
  /** Present when `format === 'ansi'`. */
  readonly ansi?: string;
  /** Present when `format === 'text'`. */
  readonly text?: string;

  readonly meta: {
    /** Scrollback statistics — present for terminal / external-terminal
     *  panes when `opts.includeScrollback` is true. */
    readonly scrollback?: { readonly totalLines: number; readonly capturedLines: number };
    /** Cursor position in the captured viewport. */
    readonly cursor?: { readonly row: number; readonly col: number };
    readonly title?: string;
  };
}

/** Build an empty snapshot — used by placeholder pane + by Phase 1
 *  stubs on pane kinds that haven't implemented full snapshot yet.
 *  Callers get a well-formed PaneSnapshot with dims + meta and no
 *  content bytes, so capture engines don't crash on a missing-content
 *  path. */
export function emptySnapshot(ref: PaneRef, kind: PaneKind, dims: Rect): PaneSnapshot {
  return {
    ref,
    kind,
    capturedAt: Date.now(),
    dims,
    cells: [],
    meta: {},
  };
}
