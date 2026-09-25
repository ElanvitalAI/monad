// R1 — Upward-picker geometry helper.
//
// Before this module: four separate code paths in chat-picker-modals
// computed overlapping arithmetic to place the picker above the
// prompt.
//
//   1. `wrapAsSurface` clickTop = anchor.row - maxVisible - 3
//   2. `paintUpwardSelect` drawRow = bounds.row - ihz - (visibleCount - r)
//   3. `paintPickerClear` loop r = bounds.row - ihz - 1 - i
//   4. `hitTestUpwardRow` topRow = bounds.row - ihz - visibleCount
//                         bottomRow = bounds.row - ihz - 1
//
// Each carried its own `- 1`, `- 3`, `- visibleCount` adjustment
// with only inline comments explaining what those magic numbers
// represent. Drift risk was high: the F-E2 `clickTop` bug surfaced
// exactly because wrapAsSurface's bounds didn't match what
// paintUpwardSelect actually rendered.
//
// This module centralises the geometry. Anchor (the prompt row) +
// parameters (`maxVisible`, `inputZoneHeight`, `hasTopHint`) fully
// determine every row position. Callers read what they need from
// the returned `UpwardPickerLayout` instead of re-deriving.
//
// The constants `PICKER_SEPARATOR_ROWS` / `PICKER_SAFETY_MARGIN` /
// `PICKER_LIST_LEFT_INDENT` are exported so tests + docs cite the
// numeric policy from one source.

import type { ModalBounds } from './modal-stack.js';
import type { Rect } from './rect.js';
import { rectClampTo } from './rect.js';

/** Rows reserved for the separator the picker paints between its
 *  list and the input zone. One `─`-line row. Extending the
 *  separator beyond 1 row would require a visual redesign; keep
 *  it here so the arithmetic reads `- PICKER_SEPARATOR_ROWS`
 *  instead of `- 1`. */
export const PICKER_SEPARATOR_ROWS = 1;

/** Rows reserved for the at-picker's optional top hint line
 *  (`↑↓ nav · Enter = attach · Tab = autofill · Esc`). slash/arg
 *  pickers don't render a hint; the F-E2 expanded bounds budget
 *  includes this row regardless so subsequent at-mode mounts
 *  don't need to re-resize. Set to 1 cell row. */
export const PICKER_TOP_HINT_ROWS = 1;

/** Extra row of bounds padding above the list so the click-bounds
 *  tolerate a 1-line `inputZoneHeight` growth without needing
 *  re-mount. Keeps the click-hit rect stable when the user types
 *  a newline inside the prompt. */
export const PICKER_SAFETY_MARGIN_ROWS = 1;

/** Cells the list body + separator visually indent from the
 *  left edge of the picker's paint column. Matches the
 *  `'  ' + sepLine` prefix in SelectView.drawUpward. */
export const PICKER_LIST_LEFT_INDENT = 2;

/** Total extra row budget above the list rows. Encapsulates what
 *  used to appear inline as `maxVisible + 3` — reads as
 *  `separator + topHint + safety`. */
export const PICKER_BOUNDS_EXTRA_ROWS =
  PICKER_SEPARATOR_ROWS + PICKER_TOP_HINT_ROWS + PICKER_SAFETY_MARGIN_ROWS;

export interface UpwardPickerLayoutInput {
  /** Prompt row (1-indexed) the picker paints above. Pickers are
   *  anchored to the current input prompt, so their top edge floats
   *  as `inputZoneHeight` changes. */
  anchorRow: number;
  /** Left-most col (1-indexed) the picker paints at. */
  anchorCol: number;
  /** Total width the picker occupies. Usually the full terminal
   *  cols. */
  width: number;
  /** Rows the input zone below the picker occupies. See
   *  `spec.getInputZoneHeight()` — evaluated per paint so the
   *  picker slides up when the prompt grows. */
  inputZoneHeight: number;
  /** Maximum rows the list body can occupy at a time. Shorter
   *  filtered lists render only `filteredCount` rows, but the
   *  click-bounds still reserve maxVisible slots so typing to
   *  a shorter filter doesn't shrink the clickable area. */
  maxVisible: number;
  /** Number of items the filtered list currently exposes. Drives
   *  the startIdx scroll math — identical to SelectView.drawUpward. */
  filteredCount: number;
  /** Cursor index within the filtered list. Used only when
   *  `filteredCount > maxVisible` to center the visible window. */
  cursor: number;
  /** True for the at-picker (reserves a topHint row above the
   *  list). False for slash / arg pickers. */
  hasTopHint: boolean;
}

export interface UpwardPickerLayout {
  /** Click-bounds Rect. Covers the list rows + separator +
   *  optional topHint + a one-row safety margin so small
   *  `inputZoneHeight` growth doesn't require re-mount. The bottom
   *  edge stops ABOVE the prompt row — callers that want to include
   *  the prompt in click forwarding need a different rect. */
  bounds: Rect;
  /** Number of list rows actually rendered this frame. Equal to
   *  `min(filteredCount, maxVisible)`. Zero when the filter has
   *  no matches (caller typically disposes the modal in that case). */
  visibleCount: number;
  /** First index into the filtered list that the visible window
   *  shows. Mirrors `SelectView.drawUpward`'s scroll math so
   *  hit-test → filtIdx and paint → filtIdx stay consistent. */
  startIdx: number;
  /** Topmost list row (1-indexed). Cursor-up from here would leave
   *  the picker. */
  listTopRow: number;
  /** Bottommost list row (1-indexed). Directly above the separator. */
  listBottomRow: number;
  /** Row the separator `─` line paints on. Directly above the
   *  input prompt zone. */
  separatorRow: number;
  /** Row the optional at-picker topHint paints on. Null for
   *  slash / arg pickers. */
  topHintRow: number | null;
}

/** Compute the canonical layout for an upward picker. Pure — no
 *  side effects, no state. Re-call freely per paint / per hit-test;
 *  the allocations are a few small objects. */
export function computeUpwardPickerLayout(input: UpwardPickerLayoutInput): UpwardPickerLayout {
  const { anchorRow, anchorCol, width, inputZoneHeight, maxVisible, filteredCount, cursor, hasTopHint } = input;

  const visibleCount = Math.max(0, Math.min(filteredCount, maxVisible));
  let startIdx = 0;
  if (filteredCount > visibleCount && visibleCount > 0) {
    startIdx = Math.max(
      0,
      Math.min(cursor - Math.floor(visibleCount / 2), filteredCount - visibleCount),
    );
  }

  const separatorRow = anchorRow - inputZoneHeight;
  const listBottomRow = separatorRow - PICKER_SEPARATOR_ROWS;
  const listTopRow = listBottomRow - Math.max(0, visibleCount - 1);
  const topHintRow = hasTopHint ? listTopRow - PICKER_TOP_HINT_ROWS : null;

  // Click-bounds: span from `maxVisible + separator + topHint + safety`
  // rows above the anchor, ending above the prompt. `maxVisible` is
  // used (not visibleCount) so a shrinking filter doesn't shrink
  // the click region and strand in-flight clicks.
  const boundsRow = Math.max(1, anchorRow - maxVisible - PICKER_BOUNDS_EXTRA_ROWS);
  const boundsHeight = Math.max(1, anchorRow - boundsRow);
  const bounds: Rect = {
    row: boundsRow,
    col: anchorCol,
    width,
    height: boundsHeight,
  };

  return {
    bounds,
    visibleCount,
    startIdx,
    listTopRow,
    listBottomRow,
    separatorRow,
    topHintRow,
  };
}

/** Clamp the layout's bounds to a terminal shape. Convenience
 *  wrapper so callers don't reach for `rectClampTo` separately. */
export function clampPickerLayoutToTerm(
  layout: UpwardPickerLayout,
  term: { rows: number; cols: number },
): UpwardPickerLayout {
  const bounds = rectClampTo(layout.bounds, term);
  return { ...layout, bounds };
}

/** Hit-test a mouse event against an upward picker's list area.
 *  Returns the `filtIdx` of the hit row, or null when the click
 *  falls outside the list band (above, below, left, right).
 *  Factored out from `hitTestUpwardRow` in chat-picker-modals; the
 *  picker now calls this plus `computeUpwardPickerLayout` rather
 *  than carrying duplicate arithmetic. */
export function hitTestPickerList(
  layout: UpwardPickerLayout,
  row: number,
  col: number,
): number | null {
  if (layout.visibleCount === 0) return null;
  if (row < layout.listTopRow || row > layout.listBottomRow) return null;
  if (col < layout.bounds.col || col >= layout.bounds.col + layout.bounds.width) return null;
  const localY = row - layout.listTopRow;
  return layout.startIdx + localY;
}

/** Compat helper for the pre-R1 ModalBounds shape. `Rect` and
 *  `ModalBounds` are structurally identical; this exists purely so
 *  TypeScript narrowing works when the caller has the former and
 *  needs the latter (or vice versa). Cheap — just an object. */
export function modalBoundsFromRect(r: Rect): ModalBounds {
  return { row: r.row, col: r.col, width: r.width, height: r.height };
}
