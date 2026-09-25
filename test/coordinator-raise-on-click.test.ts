// Q6 mouse-wiring integration · `coord.tryRaiseModalAtPoint(row, col)`
// (Phase 4 · 2026-05-03) — click-to-raise-and-focus for backgrounded
// popup-tier modals.
//
// Decisions encoded (per user-confirmed defaults):
//   - A1: raise + activate (focus moves to the raised popup)
//   - B:  left-click only (caller filters by ev.type === 'click')
//   - C:  popup tier ONLY participates; dialog/picker/menu/terminal
//         skip raise
//   - E:  no per-surface opt-out (no `noRaiseOnClick` field yet)
//
// REQUIREMENTS refs: §4.3 (Q6) · §5 F10 (focus separation invariant)

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/index.js';
import type { ModalSurface, ModalBounds } from '../src/display/modal-stack.js';
import type { ModalTier } from '../src/display/types.js';

function makeModal(opts: {
  id: string;
  tier: ModalTier;
  bounds: ModalBounds;
  focus?: 'owns' | 'participates' | 'none';
}): ModalSurface {
  return {
    id: opts.id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: opts.tier,
    focus: opts.focus ?? 'owns',
    priority: 200,
    bounds: opts.bounds,
    interactiveBounds: opts.bounds,
    occluding: false,
    render: () => [],
    paint: () => '',
  };
}

function harness(): { coord: DisplayCoordinator; flush: () => void } {
  const scheduled: Array<() => void> = [];
  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    onRender: () => { /* no-op */ },
  });
  const flush = (): void => {
    while (scheduled.length > 0) {
      const fn = scheduled.shift();
      fn?.();
    }
  };
  return { coord, flush };
}

describe('coord.tryRaiseModalAtPoint · Q6 click-to-raise', () => {
  test('returns null when no modals on stack', () => {
    const { coord } = harness();
    expect(coord.tryRaiseModalAtPoint(5, 5)).toBeNull();
  });

  test('returns null when click misses every modal', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'p1', tier: 'popup',
      bounds: { row: 1, col: 1, width: 10, height: 10 },
    }));
    flush();
    expect(coord.tryRaiseModalAtPoint(50, 50)).toBeNull();
  });

  test('two stacked popups · click on backgrounded exposed area raises it', () => {
    const { coord, flush } = harness();
    const top = makeModal({
      id: 'top', tier: 'popup',
      bounds: { row: 1, col: 1, width: 20, height: 10 },   // covers (1-10, 1-20)
    });
    const back = makeModal({
      id: 'back', tier: 'popup',
      bounds: { row: 5, col: 15, width: 20, height: 10 },  // covers (5-14, 15-34) — overlaps with top at (5-10, 15-20)
    });
    coord.pushModal(back);
    coord.pushModal(top);
    flush();
    // Stack: ['back', 'top'] — top is at index 1 (visual top).
    expect(coord.modalStack()).toEqual(['back', 'top']);

    // Click at (12, 25) — exposed area of `back` only.
    const raised = coord.tryRaiseModalAtPoint(12, 25);
    expect(raised).toBe('back');
    // After raise: back is now top of popup tier.
    expect(coord.modalStack()).toEqual(['top', 'back']);
  });

  test('click on top modal · no-op (already top of tier)', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'back', tier: 'popup',
      bounds: { row: 5, col: 15, width: 20, height: 10 },
    }));
    coord.pushModal(makeModal({
      id: 'top', tier: 'popup',
      bounds: { row: 1, col: 1, width: 20, height: 10 },
    }));
    flush();
    // Click at (5, 5) — only `top` covers this; back doesn't.
    expect(coord.tryRaiseModalAtPoint(5, 5)).toBeNull();
    // Stack unchanged.
    expect(coord.modalStack()).toEqual(['back', 'top']);
  });

  test('hit on dialog tier · NO raise (popup-only policy)', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'dlg', tier: 'dialog',
      bounds: { row: 1, col: 1, width: 30, height: 15 },
    }));
    flush();
    expect(coord.tryRaiseModalAtPoint(5, 5)).toBeNull();
  });

  test('hit on picker tier · NO raise (popup-only policy)', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'pkr', tier: 'picker',
      bounds: { row: 1, col: 1, width: 30, height: 15 },
    }));
    flush();
    expect(coord.tryRaiseModalAtPoint(5, 5)).toBeNull();
  });

  test('higher-tier surface above popup blocks raise (cross-tier z preserved · F10)', () => {
    const { coord, flush } = harness();
    // popup at (5-14, 1-20) — gets pushed FIRST so it's lower in stack.
    // dialog at (1-15, 5-30) — pushed second, covers part of popup.
    // Per F6, dialog is HIGHER tier than popup, so dialog stays on top.
    coord.pushModal(makeModal({
      id: 'pop', tier: 'popup',
      bounds: { row: 5, col: 1, width: 20, height: 10 },
    }));
    coord.pushModal(makeModal({
      id: 'dlg', tier: 'dialog',
      bounds: { row: 1, col: 5, width: 26, height: 15 },
    }));
    flush();
    // Click at (8, 10) — dialog covers this AND popup covers this.
    // tryRaise walks paintStack TOP→BOTTOM: dialog first → containment ✓
    // → tier !== 'popup' → return null. Popup never gets raised.
    expect(coord.tryRaiseModalAtPoint(8, 10)).toBeNull();
  });

  test('raise also transfers focus when target is registered', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'back', tier: 'popup',
      bounds: { row: 5, col: 15, width: 20, height: 10 },
    }));
    coord.pushModal(makeModal({
      id: 'top', tier: 'popup',
      bounds: { row: 1, col: 1, width: 20, height: 10 },
    }));
    flush();
    // top has focus initially (last pushed focusable modal).
    expect(coord.currentFocus()).toBe('top');

    // Raise back via click in its exposed area.
    expect(coord.tryRaiseModalAtPoint(12, 25)).toBe('back');
    // Focus moved to back per A1 default.
    expect(coord.currentFocus()).toBe('back');
  });

  test('idempotent: raising the already-top popup is no-op (returns null)', () => {
    const { coord, flush } = harness();
    coord.pushModal(makeModal({
      id: 'p', tier: 'popup',
      bounds: { row: 1, col: 1, width: 20, height: 10 },
    }));
    flush();
    expect(coord.tryRaiseModalAtPoint(5, 5)).toBeNull();   // already top of tier
    expect(coord.modalStack()).toEqual(['p']);
  });
});
