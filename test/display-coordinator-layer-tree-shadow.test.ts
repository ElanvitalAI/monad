// ─────────────────────────────────────────────────────────────────
// H1.3 · W1 coord attach · shadow tracker tests
//
// Verifies that DisplayCoordinator mirrors its modal stack into the
// LayerTree primitive in parallel. Phase β contract: coord remains
// authoritative, but the mirror must stay synchronized so Phase γ
// consumers (W2 RenderCoordinator · I1 Focus bridge) can read
// live state.
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { LayerId } from '../src/primitives/layer-tree/index.js';

function modal(
  id: string,
  paintBody: string,
  opts: {
    bounds?: ModalSurface['bounds'];
    tier?: ModalSurface['tier'];
    ownerWorkspaceId?: ModalSurface['ownerWorkspaceId'];
  } = {},
): ModalSurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 0,
    tier: opts.tier,
    ...(opts.ownerWorkspaceId ? { ownerWorkspaceId: opts.ownerWorkspaceId } : {}),
    bounds: opts.bounds ?? { row: 1, col: 1, width: 10, height: 4 },
    render: () => [],
    paint: () => paintBody,
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  const c = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    onRender: () => {},
    writeOverlay: () => {},
    writeCursor: () => {},
  });
  function flush() {
    while (scheduled.length > 0) scheduled.shift()!();
  }
  return { c, flush };
}

// ── Shadow mirror basics ─────────────────────────────────────────

describe('H1.3 · pushModal mirrors into LayerTree', () => {
  test('pushModal adds a layer with same id', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    const tree = h.c.layerTreeAPI();
    const node = tree.getLayer('m' as LayerId);
    expect(node).toBeDefined();
    expect(node!.id).toBe('m' as LayerId);
  });

  test('pushModal forwards bounds verbatim', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X', { bounds: { row: 5, col: 10, width: 30, height: 8 } }));
    h.flush();
    const node = h.c.layerTreeAPI().getLayer('m' as LayerId)!;
    expect(node.bounds).toEqual({ row: 5, col: 10, width: 30, height: 8 });
  });

  test('pushModal derives zTier from ModalTier (rich → 6-band rollup)', () => {
    const h = harness();
    // modalTierToZTier: 'dialog' → 'modal', 'popup' → 'popover',
    // 'tooltip' → 'overlay', undefined → 'modal' (median default).
    h.c.pushModal(modal('d', 'D', { tier: 'dialog' }));
    h.c.pushModal(modal('p', 'P', { tier: 'popup' }));
    h.c.pushModal(modal('t', 'T', { tier: 'tooltip' }));
    h.c.pushModal(modal('u', 'U'));  // no tier
    h.flush();
    const tree = h.c.layerTreeAPI();
    expect(tree.getLayer('d' as LayerId)!.zTier).toBe('modal');
    expect(tree.getLayer('p' as LayerId)!.zTier).toBe('popover');
    expect(tree.getLayer('t' as LayerId)!.zTier).toBe('overlay');
    expect(tree.getLayer('u' as LayerId)!.zTier).toBe('modal');
  });

  test('multiple pushModal · layerCount matches focus stack', () => {
    const h = harness();
    h.c.pushModal(modal('a', 'A'));
    h.c.pushModal(modal('b', 'B'));
    h.c.pushModal(modal('c', 'C'));
    h.flush();
    expect(h.c.layerTreeAPI().debug().layerCount).toBe(3);
    expect(h.c.modalStack()).toEqual(['a', 'b', 'c']);
  });
});

// ── Dispose + close ──────────────────────────────────────────────

describe('H1.3 · popModal / dispose mirrors into LayerTree', () => {
  test('popModal disposes the LayerHandle', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    h.c.popModal('m');
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('m' as LayerId)).toBeUndefined();
    expect(h.c.layerTreeAPI().debug().layerCount).toBe(0);
  });

  test('handle.dispose() from pushModal return also removes the layer', () => {
    const h = harness();
    const { dispose } = h.c.pushModal(modal('m', 'X'));
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('m' as LayerId)).toBeDefined();
    dispose();
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('m' as LayerId)).toBeUndefined();
  });

  test('popModal on unknown id does not crash the LayerTree mirror', () => {
    const h = harness();
    expect(() => h.c.popModal('ghost')).not.toThrow();
    h.flush();
    expect(h.c.layerTreeAPI().debug().layerCount).toBe(0);
  });

  test('LIFO order preserved · dispose top first then bottom', () => {
    const h = harness();
    h.c.pushModal(modal('a', 'A'));
    h.c.pushModal(modal('b', 'B'));
    h.flush();
    expect(h.c.layerTreeAPI().debug().layerCount).toBe(2);
    h.c.popModal('b');
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('a' as LayerId)).toBeDefined();
    expect(h.c.layerTreeAPI().getLayer('b' as LayerId)).toBeUndefined();
  });

  test('closing a workspace cascades dependent workspace-owned popups', () => {
    const h = harness();
    h.c.pushModal(modal('virtual-window:2', 'VW'));
    h.c.pushModal(modal('popup:vw-owned', 'P', {
      tier: 'popup',
      ownerWorkspaceId: 'virtual-window:2',
    }));
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('virtual-window:2' as LayerId)).toBeDefined();
    expect(h.c.layerTreeAPI().getLayer('popup:vw-owned' as LayerId)).toBeDefined();
    h.c.popModal('virtual-window:2');
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('virtual-window:2' as LayerId)).toBeUndefined();
    expect(h.c.layerTreeAPI().getLayer('popup:vw-owned' as LayerId)).toBeUndefined();
    expect(h.c.modalStack()).not.toContain('popup:vw-owned');
  });
});

// ── Re-push · generation increments ─────────────────────────────

describe('H1.3 · re-push (upsert) disposes stale handle then re-adds', () => {
  test('re-pushing same id · LayerTree still has exactly one layer', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    h.c.pushModal(modal('m', 'Y', { bounds: { row: 3, col: 3, width: 20, height: 10 } }));
    h.flush();
    const tree = h.c.layerTreeAPI();
    expect(tree.debug().layerCount).toBe(1);
    expect(tree.getLayer('m' as LayerId)!.bounds).toEqual({ row: 3, col: 3, width: 20, height: 10 });
  });

  test('re-push increments generation counter', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    const gen0 = h.c.layerTreeAPI().getLayer('m' as LayerId)!.generation;
    h.c.pushModal(modal('m', 'Y'));
    h.flush();
    const gen1 = h.c.layerTreeAPI().getLayer('m' as LayerId)!.generation;
    expect(gen1).toBeGreaterThan(gen0);
  });

  test('updateModalBounds moves the mirrored layer bounds in place', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X', { bounds: { row: 2, col: 3, width: 10, height: 4 } }));
    h.flush();
    expect(h.c.updateModalBounds('m', { row: 8, col: 12, width: 10, height: 4 })).toBe(true);
    h.flush();
    expect(h.c.layerTreeAPI().getLayer('m' as LayerId)!.bounds)
      .toEqual({ row: 8, col: 12, width: 10, height: 4 });
  });
});

// ── sortedByZ reflects ModalTier → ZTier rollup ─────────────────

describe('H1.3 · sortedByZ respects tier rank', () => {
  test('overlay-tier tooltip lands on top of modal-tier dialog', () => {
    const h = harness();
    h.c.pushModal(modal('d', 'D', { tier: 'dialog' }));      // → modal
    h.c.pushModal(modal('t', 'T', { tier: 'tooltip' }));     // → overlay
    h.flush();
    const sorted = h.c.layerTreeAPI().sortedByZ().map((n) => n.id);
    expect(sorted).toEqual(['d' as LayerId, 't' as LayerId]);  // bottom → top
  });
});

// ── Event mirror observed from consumer ─────────────────────────

describe('H1.3 · LayerTree events fire during shadow mirror', () => {
  test("external consumer subscribes to 'added' and 'removed' events", () => {
    const h = harness();
    const added: string[] = [];
    const removed: string[] = [];
    h.c.layerTreeAPI().on('added', (ev) => { added.push(ev.layerId); });
    h.c.layerTreeAPI().on('removed', (ev) => { removed.push(ev.layerId); });
    h.c.pushModal(modal('m1', 'X'));
    h.c.pushModal(modal('m2', 'Y'));
    h.flush();
    h.c.popModal('m1');
    h.flush();
    expect(added).toEqual(['m1', 'm2']);
    expect(removed).toEqual(['m1']);
  });
});

// ── API exposure ────────────────────────────────────────────────

describe('H1.3 · layerTreeAPI() surface', () => {
  test('layerTreeAPI returns a stable handle (same across calls)', () => {
    const h = harness();
    const a = h.c.layerTreeAPI();
    const b = h.c.layerTreeAPI();
    expect(a).toBe(b);
  });

  test('layerTreeAPI is empty until the first pushModal', () => {
    const h = harness();
    const tree = h.c.layerTreeAPI();
    expect(tree.debug().layerCount).toBe(0);
    expect(tree.sortedByZ()).toEqual([]);
    expect(tree.roots()).toEqual([]);
  });
});
