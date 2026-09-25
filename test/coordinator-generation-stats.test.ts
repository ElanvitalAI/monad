// Phase 5 (substrate Occam · F8 telemetry · 2026-05-03) —
// `coord.generationStats()` per-surface generation-bump tracking.
//
// F8 invariant ("data arrival → bump → cache miss → paint") means
// surfaces that opt into the paint cache (`generation` field) MUST
// bump on state change. Coord can't enforce this directly — it
// would require knowing surface state — but it CAN expose
// observability so operators spot surfaces with cache hits but no
// bumps (potential stale-paint risk).
//
// REQUIREMENTS ref: §5 F8 (telemetry impl), §4-pre.9 (bumpGeneration)

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeSurface(id: string, generation = 0): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'popup',
    focus: 'owns',
    priority: 200,
    bounds: { row: 1, col: 1, width: 20, height: 5 },
    occluding: false,
    render: () => [],
    paint: () => '',
    generation,
  };
}

function harness(): { coord: DisplayCoordinator; flush: () => void; nowRef: { value: number } } {
  const nowRef = { value: 1_000_000 };
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* no-op */ },
    now: () => nowRef.value,
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush, nowRef };
}

describe('coord.generationStats · F8 telemetry', () => {
  test('returns empty array when no bumps have been recorded', () => {
    const { coord } = harness();
    expect(coord.generationStats()).toEqual([]);
  });

  test('records each bumpGeneration call and exposes count + lastBumpAt', () => {
    const { coord, flush, nowRef } = harness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();

    coord.bumpGeneration(s.id);
    nowRef.value += 100;
    coord.bumpGeneration(s.id);
    nowRef.value += 100;
    coord.bumpGeneration(s.id);

    const stats = coord.generationStats();
    expect(stats.length).toBe(1);
    expect(stats[0]?.id).toBe(s.id);
    expect(stats[0]?.bumps).toBe(3);
    expect(stats[0]?.lastBumpAt).toBe(nowRef.value);
  });

  test('multiple surfaces tracked independently · sorted by lastBumpAt DESC', () => {
    const { coord, flush, nowRef } = harness();
    const a = makeSurface('a');
    const b = makeSurface('b');
    coord.pushModal(a);
    coord.pushModal(b);
    flush();

    coord.bumpGeneration(a.id);          // a at t=1_000_000
    nowRef.value += 500;
    coord.bumpGeneration(b.id);          // b at t=1_000_500
    nowRef.value += 500;
    coord.bumpGeneration(a.id);          // a at t=1_001_000

    const stats = coord.generationStats();
    expect(stats.length).toBe(2);
    // Most recent first: a (t=1_001_000), then b (t=1_000_500).
    expect(stats[0]?.id).toBe('a');
    expect(stats[0]?.bumps).toBe(2);
    expect(stats[1]?.id).toBe('b');
    expect(stats[1]?.bumps).toBe(1);
  });

  test('closeSurface clears the generation entry (no stale stats after dispose)', () => {
    const { coord, flush } = harness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    coord.bumpGeneration(s.id);
    expect(coord.generationStats().length).toBe(1);

    coord.popModal(s.id);
    flush();
    expect(coord.generationStats().length).toBe(0);
  });

  test('_resetGenerationStatsForTests clears tracking', () => {
    const { coord, flush } = harness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    coord.bumpGeneration(s.id);
    expect(coord.generationStats().length).toBe(1);
    coord._resetGenerationStatsForTests();
    expect(coord.generationStats().length).toBe(0);
  });

  test('F8 use-case scenario: surface declared generation but never bumps · stats reflect this', () => {
    // The picker (chat slash menu) opts in to generation cache via
    // its `generation: 0` declaration but mutates state via dispatch
    // path that auto-bumps (per F11). For surfaces that DO mutate
    // state outside the dispatch path, F8 expects them to call
    // bumpGeneration explicitly. This test pins the observability
    // contract: a never-bumped surface shows up with 0 entries
    // (operator can grep "no bumps recorded" via slash command).
    const { coord, flush } = harness();
    const s = makeSurface('a', 0);   // declares generation but never bumps
    coord.pushModal(s);
    flush();
    // No explicit bumpGeneration call — surface relies on auto-bump
    // (which doesn't go through bumpGeneration directly per the
    // current contract; it just paintCache.delete).
    expect(coord.generationStats()).toEqual([]);
  });
});
