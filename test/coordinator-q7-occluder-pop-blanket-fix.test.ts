// Q7 B+ (substrate Occam refactor, 2026-05-03) — occluder pop
// blanket fix. When a modal pops, the coordinator unconditionally
// triggers a full-frame redraw on the next tick so any covered
// surface that may have been skipped (occluder.occluding=true ⇒
// covered surfaces' paint() skipped while occluded) gets a fresh
// repaint immediately, eliminating the stale-pixel risk class.
//
// Federation invariant F9 (REQUIREMENTS §5) spells out this seam.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalSurface, SurfaceId } from '../src/display/index.js';

function makeOccluder(id: string): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'dialog',
    focus: 'owns',
    priority: 200,
    bounds: { row: 1, col: 1, width: 20, height: 10 },
    occluding: true,
    render: () => [],
    paint: () => '',
  };
}

function harness() {
  const renderRequests: { dirty: Set<string>; force: boolean }[] = [];
  const scheduled: Array<() => void> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: (req) => {
      renderRequests.push({ dirty: new Set(req.dirty), force: req.force });
    },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coordinator, renderRequests, flush };
}

describe('Q7 B+ — occluder pop triggers full-frame redraw', () => {
  test('popModal of an occluding modal marks all dirty', () => {
    const { coordinator, renderRequests, flush } = harness();
    const occluder = makeOccluder('occluder:1');
    coordinator.pushModal(occluder);
    flush();
    renderRequests.length = 0;   // ignore push-time render

    coordinator.popModal(occluder.id);
    flush();

    expect(renderRequests.length).toBeGreaterThan(0);
    const last = renderRequests[renderRequests.length - 1]!;
    // Q7 B+ blanket: dirty contains 'all'.
    expect(last.dirty.has('all')).toBe(true);
    // Force flag set so the renderer doesn't short-circuit on a no-op.
    expect(last.force).toBe(true);
  });

  test('popModal of a non-occluding modal also marks all dirty (universal Q7 B+)', () => {
    // The current implementation applies the blanket fix to every
    // popModal — not just occluders — so Q7 B+ holds even when the
    // surface didn't carry occluding=true. This is intentional: the
    // cost of one full-frame redraw per pop is well below a frame
    // budget, and it makes the contract trivially correct.
    const { coordinator, renderRequests, flush } = harness();
    const plain: ModalSurface = {
      ...makeOccluder('plain:1'),
      occluding: false,
    };
    coordinator.pushModal(plain);
    flush();
    renderRequests.length = 0;

    coordinator.popModal(plain.id);
    flush();

    expect(renderRequests.length).toBeGreaterThan(0);
    const last = renderRequests[renderRequests.length - 1]!;
    expect(last.dirty.has('all')).toBe(true);
    expect(last.force).toBe(true);
  });
});
