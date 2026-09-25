// ─────────────────────────────────────────────────────────────────
// W4 DamageRegion tests · H2.2 of PLAN-compositor-w4-damage-region.md
//
// 30+ cases covering:
//   - §5.1 rect-ops (11) · overlaps · adjacent · intersect · subtract · merge
//   - §5.2 DamageRegion core (8) · factory · addRect · rects snapshot
//   - §5.3 Immutable transforms (6) · union · subtract · intersect
//   - §5.4 coalesce (5)
//   - §5.5 bridge util (5) · buildDamageFromRenderCoordinator
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import {
  createDamageRegion,
  overlapsRect,
  adjacentRect,
  intersectRect,
  subtractRect,
  tryMergeRects,
  buildDamageFromRenderCoordinator,
  buildDamageFromDirtyEntries,
  invalidateRowsForDamage,
  type Rect,
} from '../src/primitives/damage-region/index.js';
import { createLayerTree, type LayerId } from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';
import type { DirtyEntry } from '../src/primitives/render-coordinator/index.js';

const rect = (row: number, col: number, w: number, h: number): Rect => ({ row, col, width: w, height: h });
const id = (s: string): LayerId => s as LayerId;

// ── §5.1 rect-ops ────────────────────────────────────────────────

describe('W4 · rect-ops · overlaps / adjacent', () => {
  test('overlapsRect · partial overlap · true', () => {
    expect(overlapsRect(rect(1, 1, 5, 5), rect(3, 3, 5, 5))).toBe(true);
  });

  test('overlapsRect · contained · true', () => {
    expect(overlapsRect(rect(1, 1, 10, 10), rect(3, 3, 4, 4))).toBe(true);
  });

  test('overlapsRect · edge-share only · false (adjacent not overlap)', () => {
    expect(overlapsRect(rect(1, 1, 5, 5), rect(1, 6, 5, 5))).toBe(false);
  });

  test('overlapsRect · disjoint · false', () => {
    expect(overlapsRect(rect(1, 1, 3, 3), rect(10, 10, 3, 3))).toBe(false);
  });

  test('adjacentRect · horizontal · true', () => {
    expect(adjacentRect(rect(1, 1, 5, 5), rect(1, 6, 5, 5))).toBe(true);
  });

  test('adjacentRect · vertical · true', () => {
    expect(adjacentRect(rect(1, 1, 5, 3), rect(4, 1, 5, 3))).toBe(true);
  });

  test('adjacentRect · overlap · false', () => {
    expect(adjacentRect(rect(1, 1, 5, 5), rect(3, 3, 5, 5))).toBe(false);
  });
});

describe('W4 · rect-ops · intersect / subtract', () => {
  test('intersectRect · partial · returns shared cells', () => {
    expect(intersectRect(rect(1, 1, 5, 5), rect(3, 3, 5, 5)))
      .toEqual(rect(3, 3, 3, 3));
  });

  test('intersectRect · disjoint · null', () => {
    expect(intersectRect(rect(1, 1, 3, 3), rect(10, 10, 3, 3))).toBeNull();
  });

  test('subtractRect · no overlap · returns [a]', () => {
    const a = rect(1, 1, 3, 3);
    expect(subtractRect(a, rect(10, 10, 3, 3))).toEqual([a]);
  });

  test('subtractRect · b contains a · returns []', () => {
    expect(subtractRect(rect(3, 3, 3, 3), rect(1, 1, 10, 10))).toEqual([]);
  });

  test('subtractRect · hole in center · 4 sub-rects', () => {
    const pieces = subtractRect(rect(1, 1, 10, 10), rect(4, 4, 4, 4));
    // Expect 4 strips (top/bottom/left/right).
    expect(pieces).toHaveLength(4);
    // Union of pieces should cover 10*10 - 4*4 = 84 cells.
    const total = pieces.reduce((acc, r) => acc + r.width * r.height, 0);
    expect(total).toBe(84);
  });
});

describe('W4 · rect-ops · tryMergeRects', () => {
  test('same row · adjacent columns · merge', () => {
    expect(tryMergeRects(rect(1, 1, 5, 3), rect(1, 6, 5, 3)))
      .toEqual(rect(1, 1, 10, 3));
  });

  test('same col · adjacent rows · merge', () => {
    expect(tryMergeRects(rect(1, 1, 5, 3), rect(4, 1, 5, 3)))
      .toEqual(rect(1, 1, 5, 6));
  });

  test('L-shape · null', () => {
    expect(tryMergeRects(rect(1, 1, 5, 3), rect(4, 4, 3, 3))).toBeNull();
  });

  test('identical rects · merge to the same rect', () => {
    expect(tryMergeRects(rect(1, 1, 5, 5), rect(1, 1, 5, 5)))
      .toEqual(rect(1, 1, 5, 5));
  });

  test('overlapping same row · merge extends cols', () => {
    expect(tryMergeRects(rect(1, 1, 5, 3), rect(1, 3, 5, 3)))
      .toEqual(rect(1, 1, 7, 3));
  });
});

// ── §5.2 DamageRegion core ───────────────────────────────────────

describe('W4 DamageRegion · core API', () => {
  test('createDamageRegion · empty by default', () => {
    const d = createDamageRegion();
    expect(d.isEmpty()).toBe(true);
    expect(d.rects()).toEqual([]);
  });

  test('addRect · makes region non-empty', () => {
    const d = createDamageRegion();
    d.addRect(rect(1, 1, 5, 5));
    expect(d.isEmpty()).toBe(false);
    expect(d.rects()).toHaveLength(1);
  });

  test('addRect with empty rect (width=0) · silently dropped', () => {
    const d = createDamageRegion();
    d.addRect(rect(1, 1, 0, 5));
    d.addRect(rect(2, 2, 5, 0));
    expect(d.isEmpty()).toBe(true);
  });

  test('rects() returns snapshot · external mutation safe', () => {
    const d = createDamageRegion();
    d.addRect(rect(1, 1, 5, 5));
    const snap = d.rects() as Rect[];
    snap.push(rect(99, 99, 1, 1));
    expect(d.rects()).toHaveLength(1);
  });

  test('createDamageRegion with initial rects', () => {
    const d = createDamageRegion([rect(1, 1, 3, 3), rect(5, 5, 3, 3)]);
    expect(d.rects()).toHaveLength(2);
  });

  test('multiple addRect · preserves insertion order', () => {
    const d = createDamageRegion();
    d.addRect(rect(1, 1, 1, 1));
    d.addRect(rect(2, 2, 1, 1));
    d.addRect(rect(3, 3, 1, 1));
    expect(d.rects().map((r) => r.row)).toEqual([1, 2, 3]);
  });

  test('repeated exact rect · not de-duped', () => {
    const d = createDamageRegion();
    d.addRect(rect(1, 1, 5, 5));
    d.addRect(rect(1, 1, 5, 5));
    expect(d.rects()).toHaveLength(2);
  });

  test('negative-width rect · dropped', () => {
    const d = createDamageRegion();
    d.addRect({ row: 1, col: 1, width: -5, height: 5 });
    expect(d.isEmpty()).toBe(true);
  });
});

// ── §5.3 Immutable transforms ────────────────────────────────────

describe('W4 DamageRegion · immutable transforms', () => {
  test('union · returns new region · original unchanged', () => {
    const a = createDamageRegion([rect(1, 1, 5, 5)]);
    const b = createDamageRegion([rect(10, 10, 5, 5)]);
    const c = a.union(b);
    expect(a.rects()).toHaveLength(1);
    expect(b.rects()).toHaveLength(1);
    expect(c.rects()).toHaveLength(2);
  });

  test('union with empty region · same contents', () => {
    const a = createDamageRegion([rect(1, 1, 5, 5)]);
    const empty = createDamageRegion();
    expect(a.union(empty).rects()).toHaveLength(1);
  });

  test('subtract · each stored rect subtracted by given rect', () => {
    const d = createDamageRegion([rect(1, 1, 10, 10)]);
    const sub = d.subtract(rect(4, 4, 4, 4));
    // Single rect with center hole subtracted → 4 strips.
    expect(sub.rects()).toHaveLength(4);
  });

  test('subtract covering all · returns empty region', () => {
    const d = createDamageRegion([rect(3, 3, 3, 3)]);
    expect(d.subtract(rect(1, 1, 20, 20)).isEmpty()).toBe(true);
  });

  test('intersect · empty intersections dropped', () => {
    const d = createDamageRegion([rect(1, 1, 3, 3), rect(10, 10, 3, 3)]);
    const c = d.intersect(rect(1, 1, 5, 5));
    expect(c.rects()).toHaveLength(1);  // only the first survives
  });

  test('intersect with disjoint clip · empty', () => {
    const d = createDamageRegion([rect(1, 1, 3, 3)]);
    expect(d.intersect(rect(100, 100, 5, 5)).isEmpty()).toBe(true);
  });
});

// ── §5.4 coalesce ────────────────────────────────────────────────

describe('W4 DamageRegion · coalesce', () => {
  test('no mergeable pairs · unchanged count', () => {
    const d = createDamageRegion([rect(1, 1, 5, 5), rect(10, 10, 5, 5)]);
    expect(d.coalesce().rects()).toHaveLength(2);
  });

  test('two horizontal adjacent · merges into 1', () => {
    const d = createDamageRegion([rect(1, 1, 5, 5), rect(1, 6, 5, 5)]);
    const c = d.coalesce();
    expect(c.rects()).toHaveLength(1);
    expect(c.rects()[0]).toEqual(rect(1, 1, 10, 5));
  });

  test('two overlapping same row · merges into 1', () => {
    const d = createDamageRegion([rect(1, 1, 5, 3), rect(1, 3, 5, 3)]);
    expect(d.coalesce().rects()).toHaveLength(1);
  });

  test('L-shape · stays 2 rects (no merge possible)', () => {
    const d = createDamageRegion([rect(1, 1, 5, 3), rect(4, 4, 3, 3)]);
    expect(d.coalesce().rects()).toHaveLength(2);
  });

  test('chain merge · 3 horizontal strips → 1 rect', () => {
    const d = createDamageRegion([
      rect(1, 1, 3, 3),
      rect(1, 4, 3, 3),
      rect(1, 7, 3, 3),
    ]);
    const c = d.coalesce();
    expect(c.rects()).toHaveLength(1);
    expect(c.rects()[0]).toEqual(rect(1, 1, 9, 3));
  });
});

// ── §5.5 bridge util ─────────────────────────────────────────────

describe('W4 · buildDamageFromRenderCoordinator', () => {
  test('empty rc · empty region', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    const damage = buildDamageFromRenderCoordinator(rc, tree);
    expect(damage.isEmpty()).toBe(true);
  });

  test('single dirty layer (no regions) · uses layer bounds', () => {
    const tree = createLayerTree();
    tree.addLayer({ id: id('m'), bounds: rect(1, 1, 10, 5), zTier: 'modal' });
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('m'));   // no region · whole layer
    const damage = buildDamageFromRenderCoordinator(rc, tree);
    expect(damage.rects()).toHaveLength(1);
    expect(damage.rects()[0]).toEqual(rect(1, 1, 10, 5));
  });

  test('respectBoundaries=true (default) · projects to boundary ancestor', () => {
    const tree = createLayerTree();
    tree.addLayer({
      id: id('modal'),
      bounds: rect(1, 1, 20, 10),
      zTier: 'modal',
      repaintBoundary: true,
    });
    tree.addLayer({
      id: id('leaf'),
      bounds: rect(5, 5, 5, 3),
      zTier: 'modal',
      parent: id('modal'),
    });
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('leaf'), rect(6, 6, 2, 2));
    const damage = buildDamageFromRenderCoordinator(rc, tree);
    // Boundary projection: leaf dirty → modal's bounds replace.
    expect(damage.rects()).toHaveLength(1);
    expect(damage.rects()[0]).toEqual(rect(1, 1, 20, 10));  // modal bounds
  });

  test('respectBoundaries=false · uses per-layer regions directly', () => {
    const tree = createLayerTree();
    tree.addLayer({
      id: id('modal'),
      bounds: rect(1, 1, 20, 10),
      zTier: 'modal',
      repaintBoundary: true,
    });
    tree.addLayer({
      id: id('leaf'),
      bounds: rect(5, 5, 5, 3),
      zTier: 'modal',
      parent: id('modal'),
    });
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('leaf'), rect(6, 6, 2, 2));
    const damage = buildDamageFromRenderCoordinator(rc, tree, { respectBoundaries: false });
    expect(damage.rects()).toHaveLength(1);
    expect(damage.rects()[0]).toEqual(rect(6, 6, 2, 2));  // raw leaf region
  });

  test('auto-coalesces adjacent dirty regions', () => {
    const tree = createLayerTree();
    tree.addLayer({ id: id('a'), bounds: rect(1, 1, 5, 5), zTier: 'modal' });
    tree.addLayer({ id: id('b'), bounds: rect(1, 6, 5, 5), zTier: 'modal' });
    const rc = createRenderCoordinator();
    rc.markNeedsPaint(id('a'));
    rc.markNeedsPaint(id('b'));
    const damage = buildDamageFromRenderCoordinator(rc, tree);
    // A + B are horizontally adjacent · should coalesce to 1.
    expect(damage.rects()).toHaveLength(1);
    expect(damage.rects()[0]).toEqual(rect(1, 1, 10, 5));
  });
});

describe('W4 · buildDamageFromDirtyEntries', () => {
  test('flush snapshot with boundary projection uses repaint root bounds', () => {
    const tree = createLayerTree();
    tree.addLayer({
      id: id('overlay'),
      bounds: rect(8, 20, 12, 2),
      zTier: 'overlay',
      repaintBoundary: true,
    });
    tree.addLayer({
      id: id('leaf'),
      bounds: rect(8, 22, 4, 1),
      zTier: 'overlay',
      parent: id('overlay'),
    });
    const entries: DirtyEntry[] = [{
      layerId: id('leaf'),
      regions: [rect(8, 22, 4, 1)],
    }];

    const damage = buildDamageFromDirtyEntries(entries, tree);
    expect(damage.rects()).toEqual([rect(8, 20, 12, 2)]);
  });

  test('respectBoundaries=false keeps raw regions from snapshot entries', () => {
    const tree = createLayerTree();
    tree.addLayer({ id: id('overlay'), bounds: rect(8, 20, 12, 2), zTier: 'overlay' });
    const entries: DirtyEntry[] = [{
      layerId: id('overlay'),
      regions: [rect(9, 23, 3, 1)],
    }];

    const damage = buildDamageFromDirtyEntries(entries, tree, { respectBoundaries: false });
    expect(damage.rects()).toEqual([rect(9, 23, 3, 1)]);
  });
});

describe('W4 · invalidateRowsForDamage', () => {
  test('marks every row touched by a coalesced region', () => {
    const damage = createDamageRegion([
      rect(3, 1, 10, 2),
      rect(7, 5, 3, 1),
    ]);
    const rows: number[] = [];

    invalidateRowsForDamage(damage, (row0) => rows.push(row0));

    expect(rows).toEqual([2, 3, 6]);
  });
});
