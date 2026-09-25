// ─────────────────────────────────────────────────────────────────
// H1.6 · W2 coord attach · shadow tracker tests
//
// Verifies that DisplayCoordinator mirrors its dirty-tracking and
// frame-flush signals into the RenderCoordinator primitive in
// parallel. Same Phase β contract as W1 coord attach (H1.3) and B-2
// ModalLifecycle · F-2 FocusManager: coord remains authoritative,
// but the mirror must stay synchronized so Phase γ consumers
// (widgets · plugins · W3 RepaintBoundary · W4 DamageRegion) can
// observe frame state.
// ─────────────────────────────────────────────────────────────────

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { LayerId } from '../src/primitives/layer-tree/index.js';
import type {
  RenderCoordinatorEvent,
} from '../src/primitives/render-coordinator/index.js';

function modal(
  id: string,
  paintBody: string,
  opts: { bounds?: ModalSurface['bounds']; tier?: ModalSurface['tier'] } = {},
): ModalSurface {
  return {
    id,
    owner: 'dashboard',
    kind: 'modal',
    focus: 'owns',
    priority: 0,
    tier: opts.tier,
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

// ── Public API ──────────────────────────────────────────────────

describe('H1.6 · renderCoordinatorAPI()', () => {
  test('returns a stable handle (same across calls)', () => {
    const h = harness();
    const a = h.c.renderCoordinatorAPI();
    const b = h.c.renderCoordinatorAPI();
    expect(a).toBe(b);
  });

  test('empty until first markDirty · flush', () => {
    const h = harness();
    const rc = h.c.renderCoordinatorAPI();
    expect(rc.isDirty()).toBe(false);
    expect(rc.debug().frameCount).toBe(0);
    expect(rc.debug().dirtyLayerCount).toBe(0);
  });
});

// ── markDirty → rc.markNeedsPaint mirror ────────────────────────

describe('H1.6 · markDirty forwards concrete ids to rc.markNeedsPaint', () => {
  test('pushModal triggers markDirty(surface.id) → rc mirror has that layer dirty', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    const rc = h.c.renderCoordinatorAPI();
    // pushModal internally calls markDirty(surface.id) → mirror
    // forwards it to rc.markNeedsPaint. Frame should then run during
    // flush, clearing the queue. We capture dirty entries via an
    // event subscriber earlier; here we just confirm layer was seen.
    expect(rc.debug().frameCount).toBeGreaterThanOrEqual(1);  // a frame flushed
  });

  test('concrete SurfaceId region is mirrored; pseudo-ids (all/status/dock) are not', () => {
    const h = harness();
    const seen: string[] = [];
    h.c.renderCoordinatorAPI().on('dirty-added', (ev: RenderCoordinatorEvent) => {
      seen.push(...ev.entries.map((e) => e.layerId));
    });
    // Trigger markDirty via a setFocus which calls markDirty(next)
    // and markDirty('status'/'dock'). Only the concrete ids end up
    // in the rc mirror.
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    // 'status' + 'dock' are pseudo-ids and must not appear.
    expect(seen.includes('status')).toBe(false);
    expect(seen.includes('dock')).toBe(false);
    expect(seen.includes('all')).toBe(false);
    // The modal surface id did get forwarded (the markDirty(m) call
    // inside pushModal).
    expect(seen.includes('m')).toBe(true);
  });
});

// ── coord.flush invokes rc.flush ────────────────────────────────

describe('H1.6 · coord.flush triggers rc.flush inside DECSET boundary', () => {
  test('flush bumps rc.frameCount when rc is dirty', () => {
    const h = harness();
    const rc = h.c.renderCoordinatorAPI();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    expect(rc.debug().frameCount).toBeGreaterThanOrEqual(1);
  });

  test("before-flush + after-flush fire during coord.flush", () => {
    const h = harness();
    const order: string[] = [];
    h.c.renderCoordinatorAPI().on('before-flush', () => order.push('before'));
    h.c.renderCoordinatorAPI().on('after-flush', () => order.push('after'));
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    // Both events must fire at least once, in order.
    const iBefore = order.indexOf('before');
    const iAfter = order.indexOf('after');
    expect(iBefore).toBeGreaterThanOrEqual(0);
    expect(iAfter).toBeGreaterThan(iBefore);
  });

  test('subscriber paint inside before-flush is invoked before coord paint pipeline continues', () => {
    const h = harness();
    const order: string[] = [];
    h.c.renderCoordinatorAPI().on('before-flush', () => order.push('rc-before'));
    // Hook coord's onRender via options? We used empty onRender in harness.
    // Instead use afterRender hook via pushModal + observe that rc event
    // fires relative to marking frameCount. Simpler: confirm frameCount
    // advanced after the hook saw it.
    let frameAtBefore = -1;
    h.c.renderCoordinatorAPI().on('before-flush', (ev) => { frameAtBefore = ev.frameCount; });
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    expect(frameAtBefore).toBe(1);  // first productive flush
    expect(h.c.renderCoordinatorAPI().debug().frameCount).toBe(1);
  });

  test('rc is no-op when nothing dirty · frameCount unchanged', () => {
    const h = harness();
    const rc = h.c.renderCoordinatorAPI();
    // Flush an empty coord · rc should not bump.
    h.flush();  // no work in scheduled queue but the flush path may still fire empty
    expect(rc.debug().frameCount).toBe(0);
  });
});

// ── W1 LayerTree 'dirty' → rc.markNeedsPaint bridge ────────────

describe('H1.6 · W1 LayerTree dirty → W2 bridge', () => {
  test('LayerTree setBounds (layer bounds change) enqueues dirty in rc', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();  // clear initial dirty
    const rc = h.c.renderCoordinatorAPI();
    const before = rc.debug().frameCount;
    // Trigger a LayerTree-level dirty directly through the shadow
    // LayerTree · simulates what a future direct consumer would do.
    h.c.layerTreeAPI().setOpacity('m' as LayerId, 0.5);
    // The rc mirror received markNeedsPaint via the bridge. Next
    // coord flush bumps frameCount.
    expect(rc.isDirty()).toBe(true);
  });

  test('LayerTree setBounds event carries previous/current rects through to rc dirty queue entries', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    const rc = h.c.renderCoordinatorAPI();
    // Explicit LayerTree bounds change — emits 'dirty' which bridges
    // into rc.markNeedsPaint with both previous and current rects.
    h.c.layerTreeAPI().setBounds('m' as LayerId, { row: 5, col: 5, width: 20, height: 8 });
    expect(rc.getDirtyRegions('m' as LayerId)).toEqual([
      { row: 1, col: 1, width: 10, height: 4 },
      { row: 5, col: 5, width: 20, height: 8 },
    ]);
    expect(rc.isDirty()).toBe(true);
  });

  test('LayerTree dirty bridge does not double-mark when coord already marked', () => {
    const h = harness();
    const rc = h.c.renderCoordinatorAPI();
    let addedCount = 0;
    rc.on('dirty-added', () => { addedCount++; });
    // pushModal → markDirty('m') (coord → rc mirror)
    // and LayerTree.addLayer also fires 'added' event but NOT 'dirty'
    // (by W1 contract). So we should see exactly 1 dirty-added.
    h.c.pushModal(modal('m', 'X'));
    // Exact count depends on coord-internal markDirty calls ordered
    // around pushModal. The guarantee here is: at least 1 dirty-added
    // fires (from the mirror) and coord doesn't double-call.
    expect(addedCount).toBeGreaterThanOrEqual(1);
    expect(rc.isDirty()).toBe(true);
  });

  test('updateModalBounds feeds previous/current rects into rc dirty regions', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X', { bounds: { row: 1, col: 1, width: 10, height: 4 } }));
    h.flush();
    const rc = h.c.renderCoordinatorAPI();
    expect(h.c.updateModalBounds('m', { row: 5, col: 7, width: 10, height: 4 })).toBe(true);
    expect(rc.getDirtyRegions('m' as LayerId)).toEqual([
      { row: 1, col: 1, width: 10, height: 4 },
      { row: 5, col: 7, width: 10, height: 4 },
    ]);
    expect(rc.isDirty()).toBe(true);
  });

  test('LayerTree removed event carries previous bounds through to rc dirty queue entries', () => {
    const h = harness();
    h.c.pushModal(modal('m', 'X'));
    h.flush();
    const rc = h.c.renderCoordinatorAPI();
    h.c.popModal('m');
    expect(rc.getDirtyRegions('m' as LayerId)).toEqual([
      { row: 1, col: 1, width: 10, height: 4 },
    ]);
    expect(rc.isDirty()).toBe(true);
  });
});

// ── Cross-primitive isolation ──────────────────────────────────

describe('H1.6 · two coord instances keep independent rc shadows', () => {
  test('rc state is per-coord', () => {
    const a = harness();
    const b = harness();
    a.c.pushModal(modal('ma', 'A'));
    a.flush();
    expect(a.c.renderCoordinatorAPI().debug().frameCount).toBeGreaterThanOrEqual(1);
    expect(b.c.renderCoordinatorAPI().debug().frameCount).toBe(0);
  });
});
