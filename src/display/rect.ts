// R1 — Rectangle primitive + pure helpers.
//
// The display layer has historically computed hit-testing, bounds
// expansion, and inside-checks inline at every call site. Four
// copies of the same `inside = ev.row >= b.row && ev.row < b.row +
// b.height && ev.col >= b.col && ev.col < b.col + b.width` pattern
// existed (dashboard-mouse-wiring, modal-adapter, chat-picker-modals
// hitTest, plus the implicit one inside getPaneHitTarget). Each
// drifted independently.
//
// This module introduces:
//   • `Rect` — the shared shape (`ModalBounds` is an alias).
//   • Pure helpers: `rectContains`, `rectShift`, `rectGrow`,
//     `rectClampTo`, `rectFromModalBounds`, `rectToModalBounds`.
//   • No mutable state; every helper returns a fresh Rect so the
//     surface lifecycle never aliases.
//
// R2 will build `LayoutSpec` (declarative anchor + preferred size)
// on top of this; R1 stays strictly behavior-preserving.

/** 1-indexed terminal row/col. `width`/`height` are cell counts.
 *  A Rect spans rows `[row, row + height - 1]` inclusive and cols
 *  `[col, col + width - 1]` inclusive. Zero-height / zero-width
 *  rects are legal and treated as empty — `rectContains` returns
 *  false for every point. */
export interface Rect {
  row: number;
  col: number;
  width: number;
  height: number;
}

/** True when `(row, col)` falls inside `r`'s cell region. Matches
 *  the inline `ev.row >= b.row && ev.row < b.row + b.height` shape
 *  exactly — swap the inlined checks with this helper to unify
 *  semantics. Zero-area rects return false for all points. */
export function rectContains(r: Rect, row: number, col: number): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  if (row < r.row || row >= r.row + r.height) return false;
  if (col < r.col || col >= r.col + r.width) return false;
  return true;
}

/** Inclusive last row (`row + height - 1`). Returns `row - 1` for
 *  zero-height rects so callers that iterate with `<=` don't enter
 *  the loop. */
export function rectBottomRow(r: Rect): number {
  return r.row + r.height - 1;
}

/** Inclusive last col. See `rectBottomRow`. */
export function rectRightCol(r: Rect): number {
  return r.col + r.width - 1;
}

/** Translate by `(dRow, dCol)` without changing size. Negative
 *  offsets allowed; callers that need clamping compose with
 *  `rectClampTo`. */
export function rectShift(r: Rect, dRow: number, dCol: number): Rect {
  return { row: r.row + dRow, col: r.col + dCol, width: r.width, height: r.height };
}

/** Expand (or shrink with negative margins) by per-side amounts.
 *  Margins are additive: `top=2` bumps the rect up 2 rows AND grows
 *  height by 2. Resulting width/height are clamped to >= 0 so empty
 *  rects stay empty. Useful for picker bounds expansion (add extra
 *  rows for topHint + safety) without scattering `- maxVisible - 3`
 *  arithmetic across the codebase. */
export function rectGrow(
  r: Rect,
  margins: { top?: number; bottom?: number; left?: number; right?: number },
): Rect {
  const top = margins.top ?? 0;
  const bottom = margins.bottom ?? 0;
  const left = margins.left ?? 0;
  const right = margins.right ?? 0;
  return {
    row: r.row - top,
    col: r.col - left,
    width: Math.max(0, r.width + left + right),
    height: Math.max(0, r.height + top + bottom),
  };
}

/** Clamp `r` to stay inside a terminal of `{rows, cols}`. Coords
 *  become 1-indexed min, width/height shrink to fit. Useful right
 *  before handing a rect off to hit-testing or paint code — avoids
 *  off-screen rows confusing downstream. */
export function rectClampTo(r: Rect, term: { rows: number; cols: number }): Rect {
  const row = Math.max(1, r.row);
  const col = Math.max(1, r.col);
  const right = Math.min(term.cols, r.col + r.width - 1);
  const bottom = Math.min(term.rows, r.row + r.height - 1);
  const width = Math.max(0, right - col + 1);
  const height = Math.max(0, bottom - row + 1);
  return { row, col, width, height };
}

/** Geometric intersection of two rects. Returns an empty rect
 *  (width or height = 0) when they don't overlap. Prefer this over
 *  hand-rolled `Math.max(a.row, b.row) ...` expansions — the sign
 *  edge cases are easy to get wrong inline. */
export function rectIntersect(a: Rect, b: Rect): Rect {
  const row = Math.max(a.row, b.row);
  const col = Math.max(a.col, b.col);
  const bottom = Math.min(rectBottomRow(a), rectBottomRow(b));
  const right = Math.min(rectRightCol(a), rectRightCol(b));
  const width = Math.max(0, right - col + 1);
  const height = Math.max(0, bottom - row + 1);
  return { row, col, width, height };
}

/** Structural equality — used by tests + memoisation paths where
 *  reference equality would mis-fire because rects are freshly
 *  allocated each tick. */
export function rectEquals(a: Rect, b: Rect): boolean {
  return a.row === b.row && a.col === b.col && a.width === b.width && a.height === b.height;
}

/** Zero-area probe. Prefer this over comparing width/height to 0
 *  manually so the semantic ("this rect doesn't occupy any cell")
 *  is explicit at call sites. */
export function rectIsEmpty(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}
