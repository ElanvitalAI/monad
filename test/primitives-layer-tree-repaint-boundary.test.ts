// ─────────────────────────────────────────────────────────────────
// W3 RepaintBoundary tests · H2.1 of PLAN-compositor-w3-repaint-boundary.md
//
// 20+ cases covering:
//   - §5.1 LayerSpec / LayerNode field round-trip (3)
//   - §5.2 setRepaintBoundary mutation (4)
//   - §5.3 findRepaintBoundaryAncestor (7)
//   - §5.4 collectRepaintRoots (6)
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import {
  createLayerTree,
  findRepaintBoundaryAncestor,
  collectRepaintRoots,
} from '../src/primitives/layer-tree/index.js';
import type {
  LayerId,
  LayerTreeEvent,
  Rect,
} from '../src/primitives/layer-tree/index.js';

const id = (s: string): LayerId => s as LayerId;
const rect = (row = 1, col = 1, width = 10, height = 4): Rect => ({ row, col, width, height });

const base = (overrides: Parameters<ReturnType<typeof createLayerTree>['addLayer']>[0] | Partial<Parameters<ReturnType<typeof createLayerTree>['addLayer']>[0]> = {}) => ({
  id: id('l1'),
  bounds: rect(),
  zTier: 'modal' as const,
  ...overrides,
});

// ── §5.1 field round-trip ────────────────────────────────────────

describe('W3 · LayerSpec / LayerNode repaintBoundary field', () => {
  test('addLayer with repaintBoundary=true · getLayer returns true', () => {
    const t = createLayerTree();
    t.addLayer(base({ repaintBoundary: true }));
    expect(t.getLayer(id('l1'))!.repaintBoundary).toBe(true);
  });

  test('addLayer without repaintBoundary · defaults to false', () => {
    const t = createLayerTree();
    t.addLayer(base());
    expect(t.getLayer(id('l1'))!.repaintBoundary).toBe(false);
  });

  test('addLayer with repaintBoundary=false · stored false', () => {
    const t = createLayerTree();
    t.addLayer(base({ repaintBoundary: false }));
    expect(t.getLayer(id('l1'))!.repaintBoundary).toBe(false);
  });
});

// ── §5.2 setRepaintBoundary mutation ────────────────────────────

describe('W3 · setRepaintBoundary mutation', () => {
  test('setRepaintBoundary(true) · value updated · fires dirty event with reason', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.addLayer(base());
    t.setRepaintBoundary(id('l1'), true);
    expect(t.getLayer(id('l1'))!.repaintBoundary).toBe(true);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('repaintBoundary');
  });

  test('setRepaintBoundary(false) after true · fires event', () => {
    const t = createLayerTree();
    t.addLayer(base({ repaintBoundary: true }));
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.setRepaintBoundary(id('l1'), false);
    expect(t.getLayer(id('l1'))!.repaintBoundary).toBe(false);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.reason).toBe('repaintBoundary');
  });

  test('setRepaintBoundary same value repeated · no-op (no event)', () => {
    const t = createLayerTree();
    const evs: LayerTreeEvent[] = [];
    t.on('dirty', (e) => evs.push(e));
    t.addLayer(base({ repaintBoundary: true }));
    t.setRepaintBoundary(id('l1'), true);   // same value
    t.setRepaintBoundary(id('l1'), true);   // same value again
    expect(evs).toHaveLength(0);
  });

  test('setRepaintBoundary on unknown id · throws', () => {
    const t = createLayerTree();
    expect(() => t.setRepaintBoundary(id('ghost'), true)).toThrow(/not mounted/);
  });
});

// ── §5.3 findRepaintBoundaryAncestor ────────────────────────────

describe('W3 · findRepaintBoundaryAncestor', () => {
  test('self is boundary · returns self', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('m'), repaintBoundary: true }));
    const anc = findRepaintBoundaryAncestor(t, id('m'));
    expect(anc?.id).toBe(id('m'));
  });

  test('parent is boundary · returns parent', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('p'), repaintBoundary: true }));
    t.addLayer(base({ id: id('c'), parent: id('p') }));
    const anc = findRepaintBoundaryAncestor(t, id('c'));
    expect(anc?.id).toBe(id('p'));
  });

  test('grandparent is boundary · returns grandparent', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('gp'), repaintBoundary: true }));
    t.addLayer(base({ id: id('p'), parent: id('gp') }));
    t.addLayer(base({ id: id('c'), parent: id('p') }));
    const anc = findRepaintBoundaryAncestor(t, id('c'));
    expect(anc?.id).toBe(id('gp'));
  });

  test('no boundary on chain · returns null', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('r') }));
    t.addLayer(base({ id: id('m'), parent: id('r') }));
    t.addLayer(base({ id: id('leaf'), parent: id('m') }));
    expect(findRepaintBoundaryAncestor(t, id('leaf'))).toBeNull();
  });

  test('root is boundary · returns root', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('r'), repaintBoundary: true }));
    t.addLayer(base({ id: id('c'), parent: id('r') }));
    expect(findRepaintBoundaryAncestor(t, id('c'))?.id).toBe(id('r'));
  });

  test('unknown id · returns null (safe query)', () => {
    const t = createLayerTree();
    expect(findRepaintBoundaryAncestor(t, id('ghost'))).toBeNull();
  });

  test('disposed layer · returns null · safe for stale event payload', () => {
    const t = createLayerTree();
    const h = t.addLayer(base({ repaintBoundary: true }));
    h.dispose();
    expect(findRepaintBoundaryAncestor(t, id('l1'))).toBeNull();
  });
});

// ── §5.4 collectRepaintRoots ────────────────────────────────────

describe('W3 · collectRepaintRoots', () => {
  test('single dirty with boundary ancestor · maps to boundary', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('modal'), repaintBoundary: true }));
    t.addLayer(base({ id: id('leaf'), parent: id('modal') }));
    const roots = collectRepaintRoots(t, [id('leaf')]);
    expect([...roots]).toEqual([id('modal')]);
  });

  test('single dirty without any boundary · maps to self', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('r') }));
    t.addLayer(base({ id: id('leaf'), parent: id('r') }));
    const roots = collectRepaintRoots(t, [id('leaf')]);
    expect([...roots]).toEqual([id('leaf')]);
  });

  test('multiple dirty sharing a boundary · de-duplicated to 1 root', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('modal'), repaintBoundary: true }));
    t.addLayer(base({ id: id('a'), parent: id('modal') }));
    t.addLayer(base({ id: id('b'), parent: id('modal') }));
    t.addLayer(base({ id: id('c'), parent: id('a') }));
    const roots = collectRepaintRoots(t, [id('a'), id('b'), id('c')]);
    expect([...roots]).toEqual([id('modal')]);
  });

  test('nested boundaries · maps to nearest (not root boundary)', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('outer'), repaintBoundary: true }));
    t.addLayer(base({ id: id('middle'), parent: id('outer'), repaintBoundary: true }));
    t.addLayer(base({ id: id('leaf'), parent: id('middle') }));
    const roots = collectRepaintRoots(t, [id('leaf')]);
    expect([...roots]).toEqual([id('middle')]);
  });

  test('empty dirty iterable · empty set', () => {
    const t = createLayerTree();
    t.addLayer(base());
    expect(collectRepaintRoots(t, []).size).toBe(0);
  });

  test('mix of dirty with and without boundary · correct mapping per entry', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('modal'), repaintBoundary: true }));
    t.addLayer(base({ id: id('leaf1'), parent: id('modal') }));
    t.addLayer(base({ id: id('standalone') }));  // no ancestor boundary
    const roots = collectRepaintRoots(t, [id('leaf1'), id('standalone')]);
    expect([...roots].sort()).toEqual([id('modal'), id('standalone')].sort());
  });

  test('Unmounted id in dirty iterable · skipped silently', () => {
    const t = createLayerTree();
    t.addLayer(base({ id: id('modal'), repaintBoundary: true }));
    t.addLayer(base({ id: id('leaf'), parent: id('modal') }));
    const roots = collectRepaintRoots(t, [id('leaf'), id('ghost')]);
    expect([...roots]).toEqual([id('modal')]);
  });
});

// ── Regression: existing W1 tests must still pass ───────────────
// (Not replicated here; verified by running full primitives-layer-tree.test.ts.)

// ── Extra · addLayer with both opacity and repaintBoundary ──────

describe('W3 · cross-field coexistence', () => {
  test('addLayer honors all W1+W3 fields simultaneously', () => {
    const t = createLayerTree();
    t.addLayer(base({
      id: id('x'),
      opacity: 0.7,
      opaque: false,
      repaintBoundary: true,
      zIndex: 5,
    }));
    const n = t.getLayer(id('x'))!;
    expect(n.opacity).toBe(0.7);
    expect(n.opaque).toBe(false);
    expect(n.repaintBoundary).toBe(true);
    expect(n.zIndex).toBe(5);
  });
});
