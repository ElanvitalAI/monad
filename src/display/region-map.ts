// Surface → row-range mapping (Phase V1).
//
// The coordinator uses this to learn "which terminal rows does this
// surface occupy?" so it can invalidate those rows' render cache
// entries on mount/unmount. That forces the main tui.ts::render loop
// to repaint them on the next frame even when the logical line
// content hasn't changed — which is exactly the situation a modal
// close produces (modal paints absolute pixels, main line buffer is
// unchanged, so differential rendering would otherwise skip the
// covered rows and leave ghost pixels).
//
// Only modal surfaces have bounds today. Panes/status/dock will be
// added in a later phase once the dashboard layout publishes its own
// bounds back to the coordinator.

import type { DisplaySurface } from './types.js';
import { isModalSurface, type ModalBounds } from './modal-stack.js';

/** Inclusive 1-indexed terminal row range. */
export interface RowRange {
  startRow: number;
  endRow: number;
}

export interface TermSize {
  rows: number;
  cols: number;
}

export interface RegionMap {
  resolve(surface: DisplaySurface, termSize: TermSize): RowRange | null;
}

export class DefaultRegionMap implements RegionMap {
  resolve(surface: DisplaySurface, termSize: TermSize): RowRange | null {
    if (isModalSurface(surface)) {
      const bounds = compactModalBounds([
        surface.bounds,
        surface.visualBounds,
        surface.backdropBounds,
      ]);
      if (bounds.length === 0) return null;
      const startRow = Math.max(
        1,
        Math.min(...bounds.map(b => b.row)),
      );
      const endRow = Math.min(
        termSize.rows,
        Math.max(...bounds.map(b => b.row + b.height - 1)),
      );
      if (endRow < startRow) return null;
      return { startRow, endRow };
    }
    return null;
  }
}

function compactModalBounds(bounds: Array<ModalBounds | undefined>): ModalBounds[] {
  return bounds.filter((b): b is ModalBounds => !!b && b.height > 0 && b.width > 0);
}

/** Union of row ranges into the smallest set of disjoint, sorted
 *  ranges. Useful when an invalidation batch would otherwise emit
 *  overlapping calls. */
export function unionRanges(ranges: readonly RowRange[]): RowRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startRow - b.startRow || a.endRow - b.endRow);
  const out: RowRange[] = [];
  let current: RowRange = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]!;
    if (r.startRow <= current.endRow + 1) {
      current.endRow = Math.max(current.endRow, r.endRow);
    } else {
      out.push(current);
      current = { ...r };
    }
  }
  out.push(current);
  return out;
}

/** True if a covers at least part of b. */
export function rangesOverlap(a: RowRange, b: RowRange): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow;
}
