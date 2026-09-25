// F5 enforcement (Federation invariant from REQUIREMENTS §5):
//   "Lifecycle events drive all axes —
//    `mounted` triggers a paint scheduling, a dispatch-chain
//    refresh, AND a generation bump.
//    `disposed` triggers a region invalidation, a focus restore,
//    AND a cache eviction."
//
// Audit (2026-05-03) located the implementation seams:
//
//   pushModal (mount)  →  markDirty(id)         (paint sched)
//                      →  setFocus / paintStack push   (dispatch refresh)
//                      →  upsertSurface         (paintCache fresh entry)
//                      →  requestFrame
//
//   closeSurface (dispose, called via popModal) →
//                      →  invalidateSurfaceRegion(surface)  (region inval)
//                      →  paintCache.delete(id)              (cache evict)
//                      →  focusManager.setFocus(previous,    (focus restore)
//                                                'closeSurface:restore')
//                      →  surfaces.delete + paintStack scrub
//
// This guard is paired with L5's `surfaceMountChurn` runtime
// counter (#1413), which catches PATHOLOGICAL mount/unmount
// sequences. F5 instead pins the per-event behavioral contract:
// every push runs the 3 mount-side effects, every pop runs the 3
// dispose-side effects.
//
// Two structural source-pattern checks anchor the dispose seams,
// + four behavioral cases cover the observable axes.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F5

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface, ModalBounds } from '../src/display/modal-stack.js';
import type { ModalTier } from '../src/display/types.js';

const ROOT = process.cwd();
const COORDINATOR_PATH = join(ROOT, 'src/display/coordinator.ts');

function harness(): {
  coord: DisplayCoordinator;
  flush: () => void;
  scheduleCalls: () => number;
} {
  let scheduleCount = 0;
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: ((fn: () => void) => {
      scheduleCount++;
      scheduled.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    onRender: () => { /* no-op */ },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush, scheduleCalls: () => scheduleCount };
}

function makeModal(opts: {
  id: string;
  tier?: ModalTier;
  bounds?: ModalBounds;
  focus?: 'owns' | 'participates' | 'none';
}): ModalSurface {
  return {
    id: opts.id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: opts.tier ?? 'popup',
    focus: opts.focus ?? 'owns',
    priority: 200,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 10 },
    interactiveBounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 10 },
    occluding: false,
    render: () => [],
    paint: () => '',
  };
}

describe('F5 federation guard · lifecycle drives all axes', () => {
  test('structural · closeSurface body invalidates region BEFORE dispose', () => {
    // Source pattern: closeSurface must call invalidateSurfaceRegion
    // before surface.dispose / paintCache.delete. The comment on
    // the canonical impl (V2) calls this out — bounds need to be
    // readable when the region is computed. A regression that
    // moves invalidateSurfaceRegion below paintCache.delete (or
    // removes it entirely) breaks F5's "region invalidation" axis.
    const source = readFileSync(COORDINATOR_PATH, 'utf8');
    const closeBodyStart = source.indexOf('private closeSurface(');
    expect(closeBodyStart).toBeGreaterThan(0);
    const closeBody = source.slice(closeBodyStart, closeBodyStart + 6000);
    const invalidateIdx = closeBody.indexOf('invalidateSurfaceRegion(surface)');
    const cacheDeleteIdx = closeBody.indexOf('this.paintCache.delete(id)');
    expect(invalidateIdx).toBeGreaterThan(0);
    expect(cacheDeleteIdx).toBeGreaterThan(0);
    if (invalidateIdx >= cacheDeleteIdx) {
      throw new Error(
        `F5 violation in closeSurface: invalidateSurfaceRegion (offset ${invalidateIdx}) `
        + `must run BEFORE paintCache.delete (offset ${cacheDeleteIdx}) — bounds must be `
        + `readable when computing the region. See REQUIREMENTS §5 F5.`,
      );
    }
  });

  test('structural · closeSurface body contains all 3 dispose-side axes', () => {
    // F5 dispose axes:
    //   region invalidation    → invalidateSurfaceRegion(surface)
    //   cache eviction         → paintCache.delete(id)
    //   focus restore          → focusManager.setFocus(...,'closeSurface:restore')
    const source = readFileSync(COORDINATOR_PATH, 'utf8');
    const closeBodyStart = source.indexOf('private closeSurface(');
    const closeBody = source.slice(closeBodyStart, closeBodyStart + 6000);
    const missing: string[] = [];
    if (!closeBody.includes('invalidateSurfaceRegion(surface)')) {
      missing.push('region invalidation (invalidateSurfaceRegion)');
    }
    if (!closeBody.includes('this.paintCache.delete(id)')) {
      missing.push('cache eviction (paintCache.delete)');
    }
    if (!closeBody.includes('closeSurface:restore')) {
      missing.push('focus restore (focusManager.setFocus(..., \'closeSurface:restore\'))');
    }
    if (missing.length > 0) {
      throw new Error(
        `F5 violation in closeSurface: missing dispose axes:\n  - ${missing.join('\n  - ')}\n\n`
        + `See REQUIREMENTS §5 F5.`,
      );
    }
    expect(missing).toEqual([]);
  });

  test('behavioral · mount triggers requestFrame (paint scheduling axis)', () => {
    // F5 mount axis 1: paint scheduling. pushModal must call
    // requestFrame so the new surface gets painted on the next
    // tick. Verified by counting `schedule` invocations.
    const { coord, scheduleCalls } = harness();
    const beforeMount = scheduleCalls();
    coord.pushModal(makeModal({ id: 'f5-mount-1' }));
    const afterMount = scheduleCalls();
    expect(afterMount).toBeGreaterThan(beforeMount);
  });

  test('behavioral · mount makes new surface the active focused modal (dispatch-chain refresh)', () => {
    // F5 mount axis 2: dispatch-chain refresh. pushModal sets the
    // new surface as the topmost focusable modal. routeKey's first
    // dispatch level (topFocusedSurface) must immediately see it.
    const { coord, flush } = harness();
    const surface = makeModal({ id: 'f5-mount-2' });
    coord.pushModal(surface);
    flush();
    expect(coord.modalStack()).toEqual(['f5-mount-2']);
    // Indirect probe: routeKey routes to this surface (or returns
    // passthrough — but it CANNOT reach the binding registry while
    // a focused modal is on top; this was F2's invariant).
    const snap = coord.snapshot();
    expect(snap.focus.active).toBe('f5-mount-2');
  });

  test('behavioral · pop restores focus to previous surface (focus restore axis)', () => {
    // F5 dispose axis 2: focus restore. Push A → push B (B is
    // active). Pop B → A becomes active. The 'closeSurface:restore'
    // reason in setFocus is the seam pinned by the structural
    // test above; here we observe its effect.
    const { coord, flush } = harness();
    coord.pushModal(makeModal({ id: 'f5-restore-a' }));
    coord.pushModal(makeModal({ id: 'f5-restore-b' }));
    flush();
    expect(coord.snapshot().focus.active).toBe('f5-restore-b');
    coord.popModal('f5-restore-b' as SurfaceId);
    flush();
    expect(coord.snapshot().focus.active).toBe('f5-restore-a');
  });

  test('behavioral · pop removes surface from registry (cache eviction co-located in same closeSurface body)', () => {
    // F5 dispose axis 3: cache eviction. Public-API observable is
    // surface registry — `coord.surface(id)` returns null after
    // pop. This is the same atomic block in closeSurface() that
    // also drops the paintCache entry (verified by the structural
    // test above that `paintCache.delete(id)` is in the body).
    // A regression that only deletes from `surfaces` but forgets
    // paintCache.delete would still pass this behavioral test BUT
    // would fail the structural test — the two together close the
    // gap.
    const { coord, flush } = harness();
    coord.pushModal(makeModal({ id: 'f5-evict' }));
    flush();
    expect(coord.surface('f5-evict' as SurfaceId)).not.toBeNull();
    coord.popModal('f5-evict' as SurfaceId);
    flush();
    expect(coord.surface('f5-evict' as SurfaceId)).toBeNull();
    // paintCache.size must also be 0 (no orphaned entry).
    expect(coord.paintCacheStats().size).toBe(0);
  });

  test('behavioral · pop schedules another frame (region invalidation triggers paint)', () => {
    // F5 dispose axis 1: region invalidation. The invalidated
    // region must trigger a frame so the underlying rows redraw.
    // popModal explicitly calls requestFrame() AFTER closeSurface
    // (line 1272) AND markDirty('all') ensures the invalidation
    // covers exposed pixels. Observable: schedule count grows.
    const { coord, flush, scheduleCalls } = harness();
    coord.pushModal(makeModal({ id: 'f5-invalidate' }));
    flush();
    const beforePop = scheduleCalls();
    coord.popModal('f5-invalidate' as SurfaceId);
    const afterPop = scheduleCalls();
    expect(afterPop).toBeGreaterThan(beforePop);
  });
});
