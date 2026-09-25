// Phase 5 (substrate Occam · L5 lesson · 2026-05-03) —
// `coord.surfaceMountChurn(id, windowMs): number` runtime counter.
// First-line warning system for the 30 Hz mount/unmount feedback
// loop class (origin: picker-flicker incident #1401). Counts
// push+pop events for a single surfaceId within a trailing window.
//
// Threshold-based warning fires automatically (debug log
// `window.mountChurn.warn`) when a surface accumulates >= 10
// events in 1000ms. The picker-flicker pattern was 30 Hz =
// 60 events/s, well above this threshold; legitimate flows (typing-
// driven picker filter rebuilds) stay under it.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeSurface(id: string): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'dialog',
    focus: 'owns',
    priority: 200,
    bounds: { row: 1, col: 1, width: 20, height: 5 },
    occluding: true,
    render: () => [],
    paint: () => '',
  };
}

function buildHarness(): { coord: DisplayCoordinator; flush: () => void; nowRef: { value: number } } {
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

describe('coord.surfaceMountChurn · runtime counter', () => {
  test('returns 0 for surfaces with no recorded events', () => {
    const { coord } = buildHarness();
    expect(coord.surfaceMountChurn('never-mounted' as SurfaceId, 1000)).toBe(0);
  });

  test('counts a single push+pop pair as 2 events within a wide window', () => {
    const { coord, flush } = buildHarness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    coord.popModal(s.id);
    flush();
    expect(coord.surfaceMountChurn(s.id, 10_000)).toBe(2);
  });

  test('events older than the window are NOT counted', () => {
    const { coord, flush, nowRef } = buildHarness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    coord.popModal(s.id);
    flush();
    // Advance time past the window.
    nowRef.value += 5_000;
    expect(coord.surfaceMountChurn(s.id, 1_000)).toBe(0);
    expect(coord.surfaceMountChurn(s.id, 10_000)).toBe(2);
  });

  test('30 Hz mount/unmount loop is detected (picker-flicker scenario)', () => {
    // Simulate 30 push/pop cycles within 500ms — the picker-flicker
    // incident pattern (#1401). Each cycle = 1 push + 1 pop = 2
    // events. 30 cycles = 60 events.
    const { coord, flush, nowRef } = buildHarness();
    const s = makeSurface('a');
    for (let i = 0; i < 30; i++) {
      coord.pushModal(s);
      flush();
      nowRef.value += 8;   // ~30 Hz pacing
      coord.popModal(s.id);
      flush();
      nowRef.value += 8;
    }
    // The bounded ring stores only the last 32 events, so we count
    // up to that ceiling within a 1000ms window. The IMPORTANT signal
    // is: count >> normal threshold (which would have triggered the
    // automatic warning).
    const churn = coord.surfaceMountChurn(s.id, 1000);
    expect(churn).toBeGreaterThanOrEqual(10);  // way above the warning threshold
  });

  test('separate surfaces have independent rings', () => {
    const { coord, flush } = buildHarness();
    const a = makeSurface('a');
    const b = makeSurface('b');
    coord.pushModal(a);
    flush();
    coord.pushModal(b);
    flush();
    coord.popModal(a.id);
    flush();
    expect(coord.surfaceMountChurn(a.id, 10_000)).toBe(2);   // push + pop
    expect(coord.surfaceMountChurn(b.id, 10_000)).toBe(1);   // push only
  });

  test('windowMs of 0 includes events at the exact "now" tick (inclusive boundary)', () => {
    const { coord, flush, nowRef } = buildHarness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    // The event was recorded at nowRef.value; cutoff = now - 0 = now;
    // event at time `now` satisfies `>= cutoff`. Inclusive boundary.
    expect(coord.surfaceMountChurn(s.id, 0)).toBe(1);
    // Advance time by 1ms — the event is now in the past, NOT counted
    // by a zero-width window.
    nowRef.value += 1;
    expect(coord.surfaceMountChurn(s.id, 0)).toBe(0);
  });

  test('_resetMountChurnForTests clears all rings', () => {
    const { coord, flush } = buildHarness();
    const s = makeSurface('a');
    coord.pushModal(s);
    flush();
    expect(coord.surfaceMountChurn(s.id, 10_000)).toBe(1);
    coord._resetMountChurnForTests();
    expect(coord.surfaceMountChurn(s.id, 10_000)).toBe(0);
  });
});
