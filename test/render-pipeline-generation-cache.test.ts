// Phase 4 (substrate Occam refactor · §4-pre.8 · 2026-05-03) —
// per-surface paint cache keyed by (id, bounds, generation). The
// coordinator threads a Map<SurfaceId, PaintCacheEntry> into
// renderModalStack each frame; on cache hit, paint() is skipped and
// the cached ANSI is reused. Pattern A (dirty-tracking mismatch) and
// Pattern D (reference-identity churn) structural defense.

import { describe, expect, test } from 'bun:test';
import {
  renderModalStack,
  type ModalSurface,
  type PaintCacheEntry,
} from '../src/display/modal-stack.js';
import { DisplayCoordinator } from '../src/display/index.js';
import type { DisplaySurface, SurfaceId } from '../src/display/index.js';

// ─── Stub surface factory ─────────────────────────────────────────
// Every paint() call increments `paintCount` so tests can assert
// hit/miss without instrumenting the cache directly.
interface CountedSurface extends ModalSurface {
  paintCount: number;
}

function makeCountedSurface(id: string, opts: {
  generation?: number;
  bounds?: { row: number; col: number; width: number; height: number };
  ansi?: string;
} = {}): CountedSurface {
  const ret: CountedSurface = {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'dialog',
    focus: 'owns',
    priority: 200,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 20, height: 10 },
    paintCount: 0,
    render: () => [],
    paint() {
      ret.paintCount += 1;
      return opts.ansi ?? `<paint id=${id} gen=${ret.generation ?? 0}>`;
    },
    ...(opts.generation !== undefined ? { generation: opts.generation } : {}),
  };
  return ret;
}

function buildSurfaces(...surfaces: ModalSurface[]): {
  surfaces: Map<SurfaceId, DisplaySurface>;
  focusStack: SurfaceId[];
} {
  const map = new Map<SurfaceId, DisplaySurface>();
  const stack: SurfaceId[] = [];
  for (const s of surfaces) {
    map.set(s.id, s);
    stack.push(s.id);
  }
  return { surfaces: map, focusStack: stack };
}

// ─── Direct renderModalStack tests (cache semantics) ─────────────

describe('renderModalStack paint cache — semantics', () => {
  test('first frame is a miss; second identical frame is a hit (paint skipped)', () => {
    const s = makeCountedSurface('a', { generation: 0 });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    const events: { id: string; hit: boolean }[] = [];
    const ansi1 = renderModalStack({ surfaces, focusStack, paintCache: cache, onPaintCache: (e) => events.push(e) });
    const ansi2 = renderModalStack({ surfaces, focusStack, paintCache: cache, onPaintCache: (e) => events.push(e) });

    expect(s.paintCount).toBe(1);          // second frame did not call paint()
    expect(ansi1).toBe(ansi2);             // same output
    expect(events).toEqual([
      { id: 'a', hit: false },
      { id: 'a', hit: true },
    ]);
  });

  test('bumping generation invalidates the cache (next frame = miss + repaint)', () => {
    const s = makeCountedSurface('a', { generation: 0 });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(1);

    s.generation = (s.generation ?? 0) + 1;
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(2);          // generation bumped → repaint
  });

  test('changing bounds (numeric values) invalidates the cache', () => {
    const s = makeCountedSurface('a', { generation: 0 });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(1);

    s.bounds = { ...s.bounds, col: 99 };   // numeric change
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(2);
  });

  test('Pattern D defense: bounds object identity churn with same numeric values still hits cache', () => {
    // Mirrors the picker-flicker bug class — paint() rewrites
    // `surface.bounds = { ... }` per frame with identical numbers.
    // Pre-cache, this triggered downstream invalidation loops; with
    // the cache, the key is purely numeric so the entry survives the
    // identity churn.
    const s = makeCountedSurface('a', { generation: 0 });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(1);

    // Same numbers, fresh object reference (mimics paint() rewriting bounds).
    s.bounds = { row: 1, col: 1, width: 20, height: 10 };
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(1);          // hit despite reference churn
  });

  test('undefined generation = NO cache (opt-in) — surface paints every frame', () => {
    // Post-#1406 hot fix: caching is opt-in by explicit `generation`
    // field declaration. Surfaces without the field paint every frame
    // — same as pre-Phase-4 behavior. This preserves existing surface
    // authoring contract for surfaces that handle input at the
    // dashboard layer (mouseWiring.handleMouse) instead of via
    // coord.routeKey / coord.routeMouseToSurface.
    const s = makeCountedSurface('a');     // no generation field
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(2);          // not cached → painted twice
    expect(cache.size).toBe(0);            // no entry written
  });

  test('opting in mid-lifetime: surface starts uncached, then declares generation, then caches', () => {
    const s = makeCountedSurface('a');     // starts without generation
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(2);          // no cache yet

    s.generation = 0;                      // opt in
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(3);          // first opted-in frame paints, second hits
  });

  test('opting out mid-lifetime: declared generation, then drop, then no cache', () => {
    const s = makeCountedSurface('a', { generation: 0 });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(1);          // cached after first
    expect(cache.size).toBe(1);

    delete (s as { generation?: number }).generation;
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(s.paintCount).toBe(3);          // no cache → both frames painted
    expect(cache.size).toBe(0);            // stale entry dropped
  });

  test('omitting paintCache disables the optimization (every frame paints)', () => {
    const s = makeCountedSurface('a', { generation: 0 });
    const { surfaces, focusStack } = buildSurfaces(s);

    renderModalStack({ surfaces, focusStack });
    renderModalStack({ surfaces, focusStack });
    expect(s.paintCount).toBe(2);          // no cache → no skip
  });

  test('multiple surfaces — each cached independently by id', () => {
    const a = makeCountedSurface('a', { generation: 0, bounds: { row: 1, col: 1, width: 5, height: 5 } });
    const b = makeCountedSurface('b', { generation: 0, bounds: { row: 6, col: 1, width: 5, height: 5 } });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(a, b);

    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(a.paintCount).toBe(1);
    expect(b.paintCount).toBe(1);

    // Bump only b; a should still cache hit, b should miss.
    b.generation = 1;
    renderModalStack({ surfaces, focusStack, paintCache: cache });
    expect(a.paintCount).toBe(1);
    expect(b.paintCount).toBe(2);
  });

  test('output of cached frame is byte-identical to fresh frame', () => {
    const s = makeCountedSurface('a', { generation: 0, ansi: '\x1b[1;1HHELLO' });
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const { surfaces, focusStack } = buildSurfaces(s);

    const fresh = renderModalStack({ surfaces, focusStack });          // no cache
    const cached1 = renderModalStack({ surfaces, focusStack, paintCache: cache });
    const cached2 = renderModalStack({ surfaces, focusStack, paintCache: cache });

    expect(cached1).toBe(fresh);
    expect(cached2).toBe(fresh);
  });
});

// ─── Coordinator integration tests ────────────────────────────────

function buildCoordHarness(): {
  coord: DisplayCoordinator;
  overlayWrites: string[];
  flush: () => void;
} {
  const overlayWrites: string[] = [];
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* dashboard would paint here; harness is no-op */ },
    writeOverlay: (ansi) => { overlayWrites.push(ansi); },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, overlayWrites, flush };
}

describe('coord paint cache — integration', () => {
  test('coord.bumpGeneration invalidates the cache (next paint = miss)', () => {
    const { coord, flush } = buildCoordHarness();
    const s = makeCountedSurface('a', { generation: 0 });
    coord.pushModal(s);
    flush();
    coord.requestRender({ region: 'all', force: true });                // trigger another flush
    flush();
    const beforeBump = s.paintCount;
    expect(beforeBump).toBeGreaterThanOrEqual(1);

    coord.bumpGeneration(s.id);
    coord.requestRender({ region: 'all', force: true });
    flush();
    expect(s.paintCount).toBe(beforeBump + 1);
  });

  test('coord.bumpGeneration returns true when cached, false when not yet painted', () => {
    const { coord, flush } = buildCoordHarness();
    const s = makeCountedSurface('a', { generation: 0 });

    expect(coord.bumpGeneration(s.id)).toBe(false);   // not registered yet

    coord.pushModal(s);
    flush();
    expect(coord.bumpGeneration(s.id)).toBe(true);    // entry exists now
  });

  test('popModal clears the cache entry — next push of same id paints fresh', () => {
    const { coord, flush } = buildCoordHarness();
    const s1 = makeCountedSurface('a', { generation: 0, ansi: 'first' });
    coord.pushModal(s1);
    flush();
    const firstCount = s1.paintCount;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    coord.popModal(s1.id);
    flush();

    // Push a NEW surface object with the same id. Coord should not
    // serve the prior cached ANSI for the new instance.
    const s2 = makeCountedSurface('a', { generation: 0, ansi: 'second' });
    coord.pushModal(s2);
    flush();
    expect(s2.paintCount).toBeGreaterThanOrEqual(1);  // fresh paint
  });

  test('auto-bump on consumed onKey: routeKey invalidates cache (per §4-pre.9)', () => {
    const { coord, flush } = buildCoordHarness();
    let counter = 0;
    const m = makeCountedSurface('a', { generation: 0 });
    m.onKey = (ev) => {
      if (ev.name !== 'down') return 'passthrough' as const;
      counter += 1;
      return 'consumed' as const;
    };
    // Make paint() output reflect the closure-captured counter so we
    // can verify a fresh paint actually ran (not just cache cleared).
    const origPaint = m.paint.bind(m);
    m.paint = function () { origPaint(); return `counter:${counter}`; };

    coord.pushModal(m);
    flush();
    const initialCount = m.paintCount;

    coord.routeKey({ name: 'down' } as Parameters<typeof coord.routeKey>[0]);
    flush();
    expect(m.paintCount).toBe(initialCount + 1);   // re-painted after consumed
  });

  test('auto-bump on consumed onMouse: routeMouseToSurface invalidates cache', () => {
    const { coord, flush } = buildCoordHarness();
    const m = makeCountedSurface('a', { generation: 0 });
    m.onMouse = (ev) => {
      if (ev.type !== 'click') return { type: 'none' } as const;
      return { type: 'refresh' } as const;        // non-none Action
    };

    coord.pushModal(m);
    flush();
    const initialCount = m.paintCount;

    coord.routeMouseToSurface(m, { type: 'click', row: 1, col: 1 } as Parameters<typeof coord.routeMouseToSurface>[1]);
    flush();
    expect(m.paintCount).toBe(initialCount + 1);
  });

  test('passthrough onKey does NOT invalidate cache (auto-bump only on consumed/action)', () => {
    const { coord, flush } = buildCoordHarness();
    const m = makeCountedSurface('a', { generation: 0 });
    m.onKey = () => 'passthrough' as const;       // never consumes

    coord.pushModal(m);
    flush();
    const initialCount = m.paintCount;

    coord.routeKey({ name: 'down' } as Parameters<typeof coord.routeKey>[0]);
    flush();
    expect(m.paintCount).toBe(initialCount);      // cache stayed valid
  });

  test('paintCacheStats tracks hits + misses across frames', () => {
    const { coord, flush } = buildCoordHarness();
    coord._resetPaintCacheForTests();
    const s = makeCountedSurface('a', { generation: 0 });

    coord.pushModal(s);
    flush();                               // miss
    coord.requestRender({ region: 'all', force: true }); flush();       // hit (no state change)
    coord.requestRender({ region: 'all', force: true }); flush();       // hit

    const stats = coord.paintCacheStats();
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.size).toBeGreaterThanOrEqual(1);
  });
});
