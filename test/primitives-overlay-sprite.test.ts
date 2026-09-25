// ─────────────────────────────────────────────────────────────────
// overlay-sprite primitive — unit tests
// · PLAN-drag-overlay-primitive.md §5.6 · 2026-04-22
//
// Covers: factory + mount (4) · first paint (3) · self-erase (7) ·
// update + dirty mark (5) · dispose + lifecycle (3) · integration (2).
// Total 24 cases.
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  createOverlaySprite,
  _resetOverlaySpriteIdCounterForTesting,
} from '../src/primitives/overlay-sprite/overlay-sprite.js';
import type {
  OverlaySpriteOptions,
  OverlaySpritePainter,
} from '../src/primitives/overlay-sprite/index.js';
import {
  createLayerTree,
  type LayerId,
  type Rect,
} from '../src/primitives/layer-tree/index.js';
import { createRenderCoordinator } from '../src/primitives/render-coordinator/index.js';

/** Fixed painter that stamps a visible sentinel at (bounds.row,
 *  bounds.col). Test assertions check for this sentinel to verify
 *  "caller's content was emitted". */
const SENTINEL = 'XX';
const sentinelPainter: OverlaySpritePainter = (b) =>
  `\x1b[${b.row};${b.col}HXX\x1b[0m`;

function mkOpts(overrides: Partial<OverlaySpriteOptions> = {}): OverlaySpriteOptions {
  return {
    tree: createLayerTree(),
    rc: createRenderCoordinator(),
    bounds: { row: 5, col: 10, width: 10, height: 1 },
    paint: sentinelPainter,
    ...overrides,
  };
}

function countEraseCells(str: string): number {
  // Each erase is `\x1b[R;CH \x1b[0m` — count the trailing ` \x1b[0m`
  // occurrences as a cheap proxy (paint strings that end with a
  // different sequence won't match).
  return (str.match(/ \x1b\[0m/g) ?? []).length;
}

function containsMoveTo(str: string, row: number, col: number): boolean {
  return str.includes(`\x1b[${row};${col}H`);
}

beforeEach(() => _resetOverlaySpriteIdCounterForTesting());

// ═══ Factory + mount ══════════════════════════════════════════════

describe('overlay-sprite · factory + mount', () => {
  test('auto id · overlay-1 on first call', () => {
    const h = createOverlaySprite(mkOpts());
    expect(h.id).toBe('overlay-1' as LayerId);
  });

  test('explicit id passes through to LayerTree', () => {
    const tree = createLayerTree();
    const h = createOverlaySprite(mkOpts({ tree, id: 'drop-zone:ghost' as LayerId }));
    expect(tree.getLayer('drop-zone:ghost' as LayerId)).toBeDefined();
    expect(h.id).toBe('drop-zone:ghost' as LayerId);
  });

  test('default zTier = overlay · repaintBoundary = true', () => {
    const tree = createLayerTree();
    const h = createOverlaySprite(mkOpts({ tree }));
    const node = tree.getLayer(h.id);
    expect(node?.zTier).toBe('overlay');
    expect(node?.repaintBoundary).toBe(true);
  });

  test('explicit zTier + zIndex + opaque honored', () => {
    const tree = createLayerTree();
    const h = createOverlaySprite(mkOpts({
      tree,
      zTier: 'popover',
      zIndex: 7,
      opaque: true,
    }));
    const node = tree.getLayer(h.id);
    expect(node?.zTier).toBe('popover');
    expect(node?.zIndex).toBe(7);
    expect(node?.opaque).toBe(true);
  });
});

// ═══ First paint ══════════════════════════════════════════════════

describe('overlay-sprite · first paint', () => {
  test('first paint emits caller content only · no erase', () => {
    const h = createOverlaySprite(mkOpts());
    expect(h.prepareFrame()).toBe('');
    const out = h.paint();
    expect(out).toContain(SENTINEL);
    expect(countEraseCells(out)).toBe(0);
  });

  test('identical bounds on second paint · no erase', () => {
    const h = createOverlaySprite(mkOpts());
    h.paint();
    const out = h.paint();
    expect(out).toContain(SENTINEL);
    expect(countEraseCells(out)).toBe(0);
  });

  test('zero-width bounds · paint returns empty-ish (no stamp · no erase)', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 0, height: 1 },
    }));
    expect(h.paint()).toBe('');
  });
});

// ═══ Self-erase (core feature · Bug 1 fix) ═══════════════════════

describe('overlay-sprite · self-erase on bounds change', () => {
  test('bounds moves to fully disjoint rect · erases all prev cells', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 4, height: 1 },
    }));
    h.paint();   // paints first
    h.update({ bounds: { row: 5, col: 20, width: 4, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    // Prev was 4 cells at (5,10)..(5,13) · all disjoint from new rect
    // at (5,20)..(5,23) · expect 4 erase cells.
    expect(countEraseCells(cleanup)).toBe(4);
    // And each prev cell is covered by moveTo:
    expect(containsMoveTo(cleanup, 5, 10)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 11)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 12)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 13)).toBe(true);
    // And new content was stamped:
    expect(out).toContain(SENTINEL);
    expect(containsMoveTo(out, 5, 20)).toBe(true);
  });

  test('bounds moves with partial overlap · only set-difference erased', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 4, height: 1 },
    }));
    h.paint();
    // New rect (5, 12, 4, 1) overlaps old at cols 12,13 · leaves 10,11
    // as the set-difference.
    h.update({ bounds: { row: 5, col: 12, width: 4, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    expect(countEraseCells(cleanup)).toBe(2);
    expect(containsMoveTo(cleanup, 5, 10)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 11)).toBe(true);
    // Overlapped cells 12,13 were NOT erased (caller's paint covers):
    // moveTo might still appear in the painter output, so check
    // absence is less reliable — instead assert 2 erases total.
  });

  test('bounds shrinks · shrunk-out cells erased', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 6, height: 1 },
    }));
    h.paint();
    h.update({ bounds: { row: 5, col: 10, width: 3, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    // Cells 13,14,15 were in old, not in new.
    expect(countEraseCells(cleanup)).toBe(3);
    expect(containsMoveTo(cleanup, 5, 13)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 14)).toBe(true);
    expect(containsMoveTo(cleanup, 5, 15)).toBe(true);
    expect(out).toContain(SENTINEL);
  });

  test('bounds expands · old cells not erased (new paint covers them)', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 3, height: 1 },
    }));
    h.paint();
    h.update({ bounds: { row: 5, col: 10, width: 6, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    expect(countEraseCells(cleanup)).toBe(0);
    expect(out).toContain(SENTINEL);
  });

  test('bounds moves vertically · full row replaced', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 4, height: 1 },
    }));
    h.paint();
    h.update({ bounds: { row: 8, col: 10, width: 4, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    expect(countEraseCells(cleanup)).toBe(4);
    expect(containsMoveTo(cleanup, 5, 10)).toBe(true);   // old row
    expect(containsMoveTo(cleanup, 5, 13)).toBe(true);
    expect(containsMoveTo(out, 8, 10)).toBe(true);   // new row
  });

  test('bounds goes to zero width · entire prev rect erased', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 4, height: 1 },
    }));
    h.paint();
    h.update({ bounds: { row: 5, col: 10, width: 0, height: 0 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    expect(countEraseCells(cleanup)).toBe(4);
    // Caller painter not called (0×0 bounds skips it).
    expect(out).not.toContain(SENTINEL);
  });

  test('painter returning empty string · erase still fires on move', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 4, height: 1 },
      paint: () => '',
    }));
    h.paint();
    h.update({ bounds: { row: 5, col: 20, width: 4, height: 1 } });
    const cleanup = h.prepareFrame();
    expect(countEraseCells(cleanup)).toBe(4);
    const out = h.paint();
    expect(out).toBe('');
  });
});

// ═══ update + dirty mark ═════════════════════════════════════════

describe('overlay-sprite · update + dirty mark', () => {
  test('same-bounds update · no dirty mark · no LayerTree event', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    let dirtyEvents = 0;
    tree.on('dirty', () => dirtyEvents++);
    const h = createOverlaySprite(mkOpts({ tree, rc }));

    const frame0 = rc.debug().frameCount;
    h.update({ bounds: h.bounds });   // same bounds
    rc.flush();
    expect(dirtyEvents).toBe(0);
    expect(rc.debug().frameCount).toBe(frame0);   // no productive flush
  });

  test('different-bounds update · 1 dirty mark · tree event fires', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    let boundsEvents = 0;
    tree.on('dirty', (ev) => { if (ev.reason === 'bounds') boundsEvents++; });
    const h = createOverlaySprite(mkOpts({ tree, rc }));

    h.update({ bounds: { row: 6, col: 10, width: 4, height: 1 } });
    expect(boundsEvents).toBe(1);
    expect(rc.isDirty()).toBe(true);
  });

  test('painter-only update · dirty mark but no tree.setBounds', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    let boundsEvents = 0;
    tree.on('dirty', (ev) => { if (ev.reason === 'bounds') boundsEvents++; });
    const h = createOverlaySprite(mkOpts({ tree, rc }));

    h.update({ paint: () => 'new-content' });
    expect(boundsEvents).toBe(0);   // no bounds change
    expect(rc.isDirty()).toBe(true);
  });

  test('identical painter reference · no dirty mark', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    const h = createOverlaySprite(mkOpts({ tree, rc, paint: sentinelPainter }));
    rc.flush();
    h.update({ paint: sentinelPainter });   // same fn reference
    expect(rc.isDirty()).toBe(false);
  });

  test('bounds + painter both change · dirty marked once', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    let addedCount = 0;
    rc.on('dirty-added', () => addedCount++);
    const h = createOverlaySprite(mkOpts({ tree, rc }));

    h.update({
      bounds: { row: 6, col: 10, width: 4, height: 1 },
      paint: () => 'x',
    });
    expect(addedCount).toBe(1);
  });
});

// ═══ dispose + lifecycle ═════════════════════════════════════════

describe('overlay-sprite · dispose', () => {
  test('dispose removes from LayerTree', () => {
    const tree = createLayerTree();
    const h = createOverlaySprite(mkOpts({ tree }));
    expect(tree.getLayer(h.id)).toBeDefined();
    h.dispose();
    expect(tree.getLayer(h.id)).toBeUndefined();
  });

  test('dispose is idempotent · double dispose silent', () => {
    const h = createOverlaySprite(mkOpts());
    h.dispose();
    expect(() => h.dispose()).not.toThrow();
  });

  test('paint + update are no-ops after dispose', () => {
    const h = createOverlaySprite(mkOpts());
    h.paint();
    h.dispose();
    expect(h.paint()).toBe('');
    expect(() =>
      h.update({ bounds: { row: 1, col: 1, width: 2, height: 2 } }),
    ).not.toThrow();
  });
});

// ═══ LayerTree + RC integration ══════════════════════════════════

describe('overlay-sprite · primitive integration', () => {
  test('sprite appears in sortedByZ · positioned per zTier', () => {
    const tree = createLayerTree();
    // Mount a 'modal' layer first — should sort BELOW an 'overlay'
    // sprite regardless of insertion order.
    tree.addLayer({
      id: 'some-modal' as LayerId,
      bounds: { row: 1, col: 1, width: 10, height: 10 },
      zTier: 'modal',
    });
    const sprite = createOverlaySprite(mkOpts({ tree }));
    const sorted = tree.sortedByZ();
    const modalIdx = sorted.findIndex(n => n.id === 'some-modal');
    const spriteIdx = sorted.findIndex(n => n.id === sprite.id);
    expect(spriteIdx).toBeGreaterThan(modalIdx);   // overlay > modal
  });

  test('rc.getDirtyRegions reports layerId after update', () => {
    const tree = createLayerTree();
    const rc = createRenderCoordinator();
    const h = createOverlaySprite(mkOpts({ tree, rc }));
    h.update({ bounds: { row: 9, col: 9, width: 4, height: 1 } });
    const regions = rc.getDirtyRegions(h.id);
    expect(regions).toBeDefined();
  });
});

describe('overlay-sprite · prepareFrame', () => {
  test('prepareFrame returns cleanup and paint returns only current stamp', () => {
    const h = createOverlaySprite(mkOpts({
      bounds: { row: 5, col: 10, width: 10, height: 1 },
    }));
    h.paint();
    h.update({ bounds: { row: 20, col: 40, width: 10, height: 1 } });
    const cleanup = h.prepareFrame();
    const out = h.paint();
    expect(countEraseCells(cleanup)).toBeGreaterThanOrEqual(10);
    expect(containsMoveTo(out, 20, 40)).toBe(true);
    expect(out.includes('\x1b[5;')).toBe(false);
  });
});
