// ─────────────────────────────────────────────────────────────────
// OverlaySprite Primitive — implementation
// · PLAN-drag-overlay-primitive.md §5 · 2026-04-22
//
// See index.ts for public API + design rationale.
// ─────────────────────────────────────────────────────────────────

import type { LayerHandle } from '../layer-tree/handle.js';
import type { LayerId, LayerTree, Rect } from '../layer-tree/index.js';
import type { RenderCoordinator } from '../render-coordinator/index.js';
import type {
  OverlaySpriteHandle,
  OverlaySpriteOptions,
  OverlaySpritePainter,
  OverlaySpriteUpdate,
} from './index.js';
import { ansi } from '../../tui.js';
import { debug } from '../../debug/log.js';

// ── id counter ────────────────────────────────────────────────────

let overlaySpriteIdCounter = 0;

// ── ANSI helpers ──────────────────────────────────────────────────

const RESET = '\x1b[0m';

/** Erase a single cell — move to position, write a single space with
 *  SGR reset to return the cell to default bg/fg. ANSI cost per cell:
 *  roughly 10 bytes; for a 32×1 ghost that's ~320 bytes per erase,
 *  which is cheap relative to a full-frame repaint. */
function eraseCell(row: number, col: number): string {
  return ansi.moveTo(row, col) + ' ' + RESET;
}

// ── Factory ───────────────────────────────────────────────────────

export function createOverlaySprite(
  opts: OverlaySpriteOptions,
): OverlaySpriteHandle {
  const id: LayerId = opts.id ?? (`overlay-${++overlaySpriteIdCounter}` as LayerId);
  const tree: LayerTree = opts.tree;
  const rc: RenderCoordinator = opts.rc;

  let bounds: Rect = opts.bounds;
  let painter: OverlaySpritePainter = opts.paint;
  /** Bounds painted on the MOST RECENT paint() call. null before the
   *  first paint — first paint() emits caller-only content (no prior
   *  bounds to erase). Cleared on dispose. */
  let prevPaintedBounds: Rect | null = null;
  let disposed = false;
  const layerHandle: LayerHandle = tree.addLayer({
    id,
    bounds,
    zTier: opts.zTier ?? 'overlay',
    zIndex: opts.zIndex ?? 0,
    opacity: 1,
    opaque: opts.opaque ?? false,
    repaintBoundary: true,
  });

  if (debug.enabled) {
    debug.log('overlay-sprite.mount', id, {
      bounds, zTier: opts.zTier ?? 'overlay', zIndex: opts.zIndex ?? 0,
    });
  }

  const markDirty = (reason: string): void => {
    if (disposed) return;
    rc.markNeedsPaint(id);
    if (debug.enabled) debug.log('overlay-sprite.dirty', id, { reason });
  };

  const prepareFrame = (): string => {
    if (disposed) return '';
    if (prevPaintedBounds === null) return '';

    const parts: string[] = [];
    emitSetDifferenceErase(parts, prevPaintedBounds, bounds);
    return parts.join('');
  };

  const paint = (): string => {
    if (disposed) return '';
    const parts: string[] = [];
    // Caller paints into the current bounds. width/height
    // <= 0 is legal (sprite-hidden) — painter may return '' and no
    // visible stamp results.
    if (bounds.width > 0 && bounds.height > 0) {
      const content = painter(bounds);
      if (content.length > 0) parts.push(content);
    }

    // Record painted bounds for the next frame's cleanup pass.
    prevPaintedBounds = { ...bounds };

    return parts.join('');
  };

  const update: OverlaySpriteHandle['update'] = (next) => {
    if (disposed) return;
    let geometryChanged = false;
    let painterChanged = false;

    if (next.bounds !== undefined && !rectEq(bounds, next.bounds)) {
      bounds = next.bounds;
      // LayerTree.setBounds fires its own 'dirty' event — the coord
      // shadow bridge forwards that to rc.markNeedsPaint(id). We also
      // call markDirty explicitly so standalone consumers (tests +
      // non-coord hosts) don't depend on the bridge.
      tree.setBounds(id, bounds);
      geometryChanged = true;
    }
    if (next.paint !== undefined && next.paint !== painter) {
      painter = next.paint;
      painterChanged = true;
    }

    if (geometryChanged || painterChanged) markDirty('update');
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    prevPaintedBounds = null;
    try { layerHandle.dispose(); }
    catch { /* tree may have been torn down */ }
    if (debug.enabled) debug.log('overlay-sprite.dispose', id, {});
  };

  return {
    id,
    get bounds() { return bounds; },
    prepareFrame,
    paint,
    update,
    dispose,
  };
}

// ── Helpers (pure) ────────────────────────────────────────────────

function rectEq(a: Rect, b: Rect): boolean {
  return a.row === b.row
    && a.col === b.col
    && a.width === b.width
    && a.height === b.height;
}

/** Emit erase sequences for cells in `prev` that are NOT in `curr`.
 *
 *  Naive cell-by-cell scan — prev rects are typically small (≤2 rows
 *  × ≤ 32 cols for the drop-zone ghost, a single fill rect for the
 *  highlight). A row-run coalescer is possible refinement (see
 *  PLAN §5.4) but not needed until real performance data points
 *  demand it. */
function emitSetDifferenceErase(
  parts: string[],
  prev: Rect,
  curr: Rect,
): void {
  if (prev.width <= 0 || prev.height <= 0) return;
  const currR0 = curr.row;
  const currR1 = curr.row + curr.height;
  const currC0 = curr.col;
  const currC1 = curr.col + curr.width;
  const currValid = curr.width > 0 && curr.height > 0;

  for (let r = prev.row; r < prev.row + prev.height; r++) {
    const inCurrRow = currValid && r >= currR0 && r < currR1;
    for (let c = prev.col; c < prev.col + prev.width; c++) {
      if (inCurrRow && c >= currC0 && c < currC1) continue;
      parts.push(eraseCell(r, c));
    }
  }
}

// ── Test helper (intentionally exported · mirrors chrome-layer) ──

/** Reset the auto-id counter · test-only. Not part of the public
 *  contract — calling this from production code would invalidate
 *  layer ids that are still live in a tree. */
export function _resetOverlaySpriteIdCounterForTesting(): void {
  overlaySpriteIdCounter = 0;
}
