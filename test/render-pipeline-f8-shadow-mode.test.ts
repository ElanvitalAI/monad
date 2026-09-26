// Phase 5 F8 shadow mode (2026-05-03 · ELANOUS_F8_SHADOW=1).
//
// F8 telemetry (#1424) tracks generation bumps; shadow mode is the
// runtime CHECK that complements it. When env var ELANOUS_F8_SHADOW=1
// is set, every paint cache HIT also re-runs `surface.paint()` and
// compares the fresh ANSI string against the cached `prior.ansi`.
// A divergence means the surface mutated state without bumping
// generation — exactly the F8 violation class (data ↔ paint seam
// broken).
//
// The cache value is still used for the actual frame (no double-
// emit, no behavior change). The check is observability-only:
// divergences accumulate into `coord.f8ShadowStats()` and emit
// `window.f8.shadowDivergence` debug logs.
//
// Off-state (env unset · default) is zero-cost.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §7
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §5 F8

import { describe, expect, test } from 'bun:test';
import { renderModalStack } from '../src/display/modal-stack.js';
import type { ModalSurface, PaintCacheEntry } from '../src/display/modal-stack.js';
import type { DisplaySurface, SurfaceId } from '../src/display/types.js';

function makeModal(opts: {
  id: string;
  paint: () => string;
  generation?: number;
  bounds?: { row: number; col: number; width: number; height: number };
}): ModalSurface {
  return {
    id: opts.id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'popup',
    focus: 'owns',
    priority: 200,
    bounds: opts.bounds ?? { row: 1, col: 1, width: 10, height: 5 },
    interactiveBounds: opts.bounds ?? { row: 1, col: 1, width: 10, height: 5 },
    occluding: false,
    render: () => [],
    paint: opts.paint,
    generation: opts.generation,
  };
}

describe('F8 shadow mode · cache-hit divergence detection', () => {
  test('off-state · no extra paint() calls when shadowMode is false', () => {
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    let paintCalls = 0;
    const surface = makeModal({
      id: 's-off',
      generation: 0,
      paint: () => { paintCalls++; return 'ANSI-A'; },
    });
    surfaces.set(surface.id, surface);

    // First render: cache miss → paint called once.
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
    });
    expect(paintCalls).toBe(1);

    // Second render WITHOUT shadowMode: cache hit → paint NOT called.
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
    });
    expect(paintCalls).toBe(1);

    // Same with `shadowMode: false` explicit.
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: false,
    });
    expect(paintCalls).toBe(1);
  });

  test('shadow on · cache hit triggers an extra paint() that matches → no divergence', () => {
    // Shadow on. Surface returns the SAME string every time (no
    // hidden state mutation). Cache hit re-runs paint, fresh ===
    // prior.ansi → no divergence callback.
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    let paintCalls = 0;
    const surface = makeModal({
      id: 's-stable',
      generation: 0,
      paint: () => { paintCalls++; return 'STABLE'; },
    });
    surfaces.set(surface.id, surface);

    // Prime cache: miss → paint called.
    renderModalStack({ surfaces, focusStack: [surface.id], paintCache: cache });
    expect(paintCalls).toBe(1);

    let divergences = 0;
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: true,
      onShadowDivergence: () => { divergences++; },
    });
    // paint() ran a second time for the shadow check.
    expect(paintCalls).toBe(2);
    // No divergence — string was identical.
    expect(divergences).toBe(0);
  });

  test('shadow on · surface mutates state without bumping generation → divergence detected', () => {
    // The F8 violation scenario: surface mutates internal state
    // between renders but forgets to bump `generation`. Cache hit
    // would emit stale ANSI in production. Shadow mode catches this.
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    let counter = 0;
    const surface = makeModal({
      id: 's-mutating',
      generation: 0,
      // Each paint() returns a different string — simulating an
      // F8 violation (state changed, generation didn't).
      paint: () => `ANSI-${counter++}`,
    });
    surfaces.set(surface.id, surface);

    // Prime cache: counter 0 → 1, cached value = 'ANSI-0'.
    renderModalStack({ surfaces, focusStack: [surface.id], paintCache: cache });

    const divergences: Array<{ id: SurfaceId; key: string; priorLen: number; freshLen: number }> = [];
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: true,
      onShadowDivergence: (ev) => { divergences.push(ev); },
    });
    // Shadow re-paint produced 'ANSI-1' (counter incremented), but
    // cached was 'ANSI-0' → divergence.
    expect(divergences).toHaveLength(1);
    expect(divergences[0]!.id).toBe(surface.id);
    // priorLen and freshLen both report the cached + fresh string
    // sizes; here ANSI-0 and ANSI-1 are the same length (6) — but
    // length equality doesn't imply value equality, which is why
    // the divergence still fires (compare-by-string, not by length).
    expect(divergences[0]!.priorLen).toBe('ANSI-0'.length);
  });

  test('shadow on · cache miss path is unaffected (no shadow on first paint)', () => {
    // Shadow check is a HIT-side concern. Misses go through the
    // normal `cache.set + paint` path; shadow mode doesn't enable
    // divergence callbacks for misses.
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    const surface = makeModal({
      id: 's-miss',
      generation: 0,
      paint: () => 'FIRST',
    });
    surfaces.set(surface.id, surface);

    let divergences = 0;
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: true,
      onShadowDivergence: () => { divergences++; },
    });
    // First call = miss; no shadow check, no divergence.
    expect(divergences).toBe(0);
  });

  test('shadow on · non-cached surface (no generation field) is unaffected', () => {
    // Surfaces without `generation` opt out of caching entirely;
    // they paint every frame, no hit/miss decision. Shadow mode
    // shouldn't fire on them either.
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    let paintCalls = 0;
    const surface = makeModal({
      id: 's-no-cache',
      // generation intentionally omitted
      paint: () => { paintCalls++; return 'EVERY-FRAME'; },
    });
    surfaces.set(surface.id, surface);

    let divergences = 0;
    renderModalStack({ surfaces, focusStack: [surface.id], paintCache: cache });
    renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: true,
      onShadowDivergence: () => { divergences++; },
    });
    // 2 calls (one per frame); no shadow re-paint because the
    // hit-path never executed.
    expect(paintCalls).toBe(2);
    expect(divergences).toBe(0);
  });

  test('shadow on · paint() throwing during shadow check does not crash the frame', () => {
    const surfaces = new Map<SurfaceId, DisplaySurface>();
    const cache = new Map<SurfaceId, PaintCacheEntry>();
    let firstCall = true;
    const surface = makeModal({
      id: 's-throws-on-shadow',
      generation: 0,
      paint: () => {
        if (firstCall) {
          firstCall = false;
          return 'OK';   // priming: succeeds
        }
        throw new Error('shadow paint blew up');
      },
    });
    surfaces.set(surface.id, surface);

    renderModalStack({ surfaces, focusStack: [surface.id], paintCache: cache });

    // Shadow re-paint throws; renderModalStack must swallow + still
    // emit the cached value.
    const ansi = renderModalStack({
      surfaces,
      focusStack: [surface.id],
      paintCache: cache,
      shadowMode: true,
      onShadowDivergence: () => { /* noop */ },
    });
    expect(ansi).toBe('OK');
  });
});
