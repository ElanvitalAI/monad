// ─────────────────────────────────────────────────────────────────
// W4 DamageRegion · rect-ops pure utilities
// · H2.2 of PLAN-compositor-w4-damage-region.md
//
// All operations treat Rect as cell-integer regions (1-indexed
// row/col, non-negative width/height). Rect 는 row/col 이 **start**
// (inclusive) · row+height-1 이 last row (inclusive).
//
// Pure · no allocation except return values · side-effect 없음.
// ─────────────────────────────────────────────────────────────────

import type { Rect } from '../layer-tree/index.js';

/** A rect's inclusive last-row / last-col · caller perf: recompute
 *  when calling, but helper stays simple + branch-free readable. */
function endRow(r: Rect): number { return r.row + r.height - 1; }
function endCol(r: Rect): number { return r.col + r.width - 1; }

/** True when two rects share at least one cell. Edge-touching rects
 *  do NOT overlap (they're adjacent · see `adjacentRect`). */
export function overlapsRect(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return !(
    endCol(a) < b.col || endCol(b) < a.col ||
    endRow(a) < b.row || endRow(b) < a.row
  );
}

/** True when two rects share an edge (adjacent · not overlapping)
 *  AND the shared edge length > 0. Horizontal or vertical. */
export function adjacentRect(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  if (overlapsRect(a, b)) return false;
  // Horizontally adjacent: endCol+1 === other.col AND rows overlap.
  if (endCol(a) + 1 === b.col || endCol(b) + 1 === a.col) {
    const rowsOverlap = !(endRow(a) < b.row || endRow(b) < a.row);
    return rowsOverlap;
  }
  // Vertically adjacent: endRow+1 === other.row AND cols overlap.
  if (endRow(a) + 1 === b.row || endRow(b) + 1 === a.row) {
    const colsOverlap = !(endCol(a) < b.col || endCol(b) < a.col);
    return colsOverlap;
  }
  return false;
}

/** Intersection · returns null when no shared cells. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  if (!overlapsRect(a, b)) return null;
  const row = Math.max(a.row, b.row);
  const col = Math.max(a.col, b.col);
  const eRow = Math.min(endRow(a), endRow(b));
  const eCol = Math.min(endCol(a), endCol(b));
  return { row, col, width: eCol - col + 1, height: eRow - row + 1 };
}

/** Difference · `a` minus `b`. Returns 0..4 sub-rects describing
 *  the cells of `a` not covered by `b`. Standard rect-difference
 *  algorithm · splits into at most 4 strips (top · bottom · left ·
 *  right of the intersection). */
export function subtractRect(a: Rect, b: Rect): readonly Rect[] {
  if (!overlapsRect(a, b)) return [a];
  const inter = intersectRect(a, b);
  if (!inter) return [a];
  // `b` contains `a` entirely?
  if (inter.row === a.row && inter.col === a.col &&
      inter.width === a.width && inter.height === a.height) {
    return [];
  }
  const out: Rect[] = [];
  // Top strip · rows of `a` above `inter`.
  if (a.row < inter.row) {
    out.push({ row: a.row, col: a.col, width: a.width, height: inter.row - a.row });
  }
  // Bottom strip · rows of `a` below `inter`.
  if (endRow(a) > endRow(inter)) {
    const br = endRow(inter) + 1;
    out.push({ row: br, col: a.col, width: a.width, height: endRow(a) - br + 1 });
  }
  // Left strip · cells in the inter-row band, left of inter.
  if (a.col < inter.col) {
    out.push({ row: inter.row, col: a.col, width: inter.col - a.col, height: inter.height });
  }
  // Right strip · cells in the inter-row band, right of inter.
  if (endCol(a) > endCol(inter)) {
    const bc = endCol(inter) + 1;
    out.push({ row: inter.row, col: bc, width: endCol(a) - bc + 1, height: inter.height });
  }
  return out;
}

/** Try to merge two rects into a single covering rect. Returns the
 *  merged rect only when the union is itself rectangular (no
 *  L-shape etc.). Two cases succeed:
 *   (1) same row-range AND adjacent/overlapping columns
 *   (2) same col-range AND adjacent/overlapping rows
 *  Otherwise returns null. */
export function tryMergeRects(a: Rect, b: Rect): Rect | null {
  if (a.width <= 0 || a.height <= 0) return null;
  if (b.width <= 0 || b.height <= 0) return null;
  // Same row-range (height + row equal) → maybe horizontal merge.
  if (a.row === b.row && a.height === b.height) {
    const aEnd = endCol(a), bEnd = endCol(b);
    // Overlapping or adjacent in column-axis?
    const canMerge = !(aEnd + 1 < b.col || bEnd + 1 < a.col);
    if (canMerge) {
      const col = Math.min(a.col, b.col);
      const lastCol = Math.max(aEnd, bEnd);
      return { row: a.row, col, width: lastCol - col + 1, height: a.height };
    }
  }
  // Same col-range (width + col equal) → maybe vertical merge.
  if (a.col === b.col && a.width === b.width) {
    const aEnd = endRow(a), bEnd = endRow(b);
    const canMerge = !(aEnd + 1 < b.row || bEnd + 1 < a.row);
    if (canMerge) {
      const row = Math.min(a.row, b.row);
      const lastRow = Math.max(aEnd, bEnd);
      return { row, col: a.col, width: a.width, height: lastRow - row + 1 };
    }
  }
  return null;
}
