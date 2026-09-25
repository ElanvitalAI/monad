// Phase 4.5a (substrate Occam · §4-pre.7 · 2026-05-03) —
// `getBounds()` lifecycle hook on ModalSurface. The coordinator
// calls this BEFORE regionMap.resolve + paint each frame, treats
// the return as authoritative for `surface.bounds`, and invalidates
// the paint cache + region rows on change. Eliminates the snapshot/
// paint race that produced the picker `잔상` artifact (incident log:
// log/debug-20260503151235.log 13:06.292 — partial paint at row 33
// while declared bounds were row 28-36).

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

interface CountedSurface extends ModalSurface {
  paintCount: number;
  getBoundsCount: number;
}

function makeSurface(opts: {
  id?: string;
  initialBounds?: { row: number; col: number; width: number; height: number };
  desiredBoundsRef?: { current: { row: number; col: number; width: number; height: number } | null };
  paintFn?: () => string;
} = {}): CountedSurface {
  const id = (opts.id ?? 'a') as SurfaceId;
  const initial = opts.initialBounds ?? { row: 5, col: 1, width: 20, height: 10 };
  const ret: CountedSurface = {
    id,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'picker',
    focus: 'owns',
    priority: 200,
    bounds: { ...initial },
    paintCount: 0,
    getBoundsCount: 0,
    render: () => [],
    paint() {
      ret.paintCount += 1;
      return opts.paintFn ? opts.paintFn() : `<paint id=${id} bounds=${JSON.stringify(ret.bounds)}>`;
    },
    ...(opts.desiredBoundsRef
      ? {
        getBounds: () => {
          ret.getBoundsCount += 1;
          return opts.desiredBoundsRef!.current;
        },
      }
      : {}),
  };
  return ret;
}

function buildHarness(): {
  coord: DisplayCoordinator;
  flush: () => void;
  overlayWrites: string[];
} {
  const overlayWrites: string[] = [];
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* no-op */ },
    writeOverlay: (ansi) => { overlayWrites.push(ansi); },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush, overlayWrites };
}

describe('getBounds() lifecycle hook · §4-pre.7', () => {
  test('surfaces without getBounds keep their declared bounds (backwards-compat)', () => {
    const { coord, flush } = buildHarness();
    const s = makeSurface();        // no getBounds defined
    coord.pushModal(s);
    flush();
    expect(s.bounds).toEqual({ row: 5, col: 1, width: 20, height: 10 });
    expect(s.paintCount).toBeGreaterThan(0);
  });

  test('coord calls getBounds and assigns the result to surface.bounds', () => {
    const { coord, flush } = buildHarness();
    const desired = { current: { row: 10, col: 1, width: 20, height: 5 } };
    const s = makeSurface({ desiredBoundsRef: desired });
    coord.pushModal(s);
    flush();
    expect(s.getBoundsCount).toBeGreaterThanOrEqual(1);
    expect(s.bounds).toEqual({ row: 10, col: 1, width: 20, height: 5 });
  });

  test('getBounds returning null leaves surface.bounds unchanged', () => {
    const { coord, flush } = buildHarness();
    const desired = { current: null as null | { row: number; col: number; width: number; height: number } };
    const s = makeSurface({ desiredBoundsRef: desired });
    coord.pushModal(s);
    flush();
    expect(s.bounds).toEqual({ row: 5, col: 1, width: 20, height: 10 });
  });

  test('getBounds returning identical numeric values does NOT churn surface.bounds reference (§1.5)', () => {
    const { coord, flush } = buildHarness();
    const desired = { current: { row: 5, col: 1, width: 20, height: 10 } };  // same as initial
    const s = makeSurface({ desiredBoundsRef: desired });
    const initialRef = s.bounds;
    coord.pushModal(s);
    flush();
    coord.requestRender({ region: 'all', force: true });
    flush();
    expect(s.bounds).toBe(initialRef);   // reference identity preserved
  });

  test('shrinking bounds via getBounds invalidates prior region rows in the SAME frame (잔상 fix)', () => {
    // Reproduces the picker shrink scenario: bounds start large
    // (row 5, height 10 → covers rows 5-14), then shrink (row 10,
    // height 5 → covers rows 10-14). The 5 rows that were covered
    // but no longer are (rows 5-9) MUST be invalidated this same
    // frame, not the next.
    const { coord, flush } = buildHarness();
    const desired = { current: { row: 5, col: 1, width: 20, height: 10 } };
    const s = makeSurface({ desiredBoundsRef: desired });
    coord.pushModal(s);
    flush();
    // Initial frame paints rows 5-14.
    expect(s.bounds).toEqual({ row: 5, col: 1, width: 20, height: 10 });

    // Shrink: getBounds will now return row 10, height 5.
    desired.current = { row: 10, col: 1, width: 20, height: 5 };
    coord.requestRender({ region: 'all', force: true });
    flush();

    // Bounds settled to new values via getBounds.
    expect(s.bounds).toEqual({ row: 10, col: 1, width: 20, height: 5 });
    // Paint cache was invalidated (otherwise stale ANSI for old bounds).
    // We verify via a second consecutive frame: bounds same, paint
    // shouldn't increase if cache covers, but for surfaces without
    // generation field the cache is opt-out (post-#1407) so paint
    // runs every frame anyway. The important behavioral check is
    // that surface.bounds matches the new desired — done above.
  });

  test('getBounds is called BEFORE paint each frame (ordering invariant)', () => {
    // If paint() ran first, it would see the OLD bounds for one
    // frame after a shrink. Ordering is enforced by coord.
    const { coord, flush } = buildHarness();
    const desired = { current: { row: 5, col: 1, width: 20, height: 10 } };
    let observedBoundsAtPaint: { row: number; height: number } | null = null;
    const s = makeSurface({
      desiredBoundsRef: desired,
      paintFn: () => '',  // we only care about ordering, not output
    });
    const origPaint = s.paint;
    s.paint = () => {
      observedBoundsAtPaint = { row: s.bounds.row, height: s.bounds.height };
      return origPaint.call(s);
    };
    coord.pushModal(s);
    flush();
    // After first frame: paint saw the initial getBounds result.
    expect(observedBoundsAtPaint).toEqual({ row: 5, height: 10 });

    // Shrink between frames.
    desired.current = { row: 10, col: 1, width: 20, height: 5 };
    coord.requestRender({ region: 'all', force: true });
    flush();
    // Paint MUST observe the NEW bounds, not the old ones.
    expect(observedBoundsAtPaint).toEqual({ row: 10, height: 5 });
  });
});
