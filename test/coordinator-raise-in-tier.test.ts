// Q6 (Phase 4 partial · drag-to-front, 2026-05-03) — coord.raiseInTier
// pins the within-tier z-mutation contract:
//
//   1. Raising moves the target to the top of its OWN tier.
//   2. Surfaces in HIGHER tiers stay above the raised target (F6).
//   3. Surfaces in LOWER tiers stay below (F6).
//   4. Focus owner is unchanged (F10) — raising is z-order only.
//   5. Idempotent: raising the already-top-of-tier returns false.
//
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03`
//   §4.3 (Q6 decision) · §5 F10 (focus separation invariant)
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §6

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function harness() {
  const scheduled: Array<() => void> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
  });
  return { coordinator, scheduled };
}

function modal(opts: {
  id: SurfaceId;
  tier: ModalTier;
  focusable?: boolean;
  row?: number;
  col?: number;
}): ModalSurface {
  return {
    id: opts.id,
    kind: 'modal',
    owner: 'dashboard',
    focus: opts.focusable === false ? 'none' : 'owns',
    priority: 100,
    tier: opts.tier,
    bounds: { row: opts.row ?? 1, col: opts.col ?? 1, width: 10, height: 3 },
    interactiveBounds: { row: opts.row ?? 1, col: opts.col ?? 1, width: 10, height: 3 },
    visualBounds: { row: opts.row ?? 1, col: opts.col ?? 1, width: 10, height: 3 },
    backdropBounds: { row: opts.row ?? 1, col: opts.col ?? 1, width: 10, height: 3 },
    render: () => [],
    paint: () => '',
  };
}

describe('Q6 raiseInTier — within-tier drag-to-front', () => {
  test('raise a backgrounded popup — moves to top of popup tier', () => {
    const { coordinator } = harness();
    const a = modal({ id: 'popup:a' as SurfaceId, tier: 'popup', row: 1 });
    const b = modal({ id: 'popup:b' as SurfaceId, tier: 'popup', row: 5 });
    coordinator.pushModal(a);
    coordinator.pushModal(b);

    // Default: b is on top (push order)
    expect(coordinator.snapshot().focus.stack.at(-1)).toBe('popup:b');

    // Raise a — should move to top
    expect(coordinator.raiseInTier('popup:a' as SurfaceId)).toBe(true);
    expect(coordinator.snapshot().focus.stack.at(-1)).toBe('popup:a');
  });

  test('raising preserves cross-tier ordering (F6 invariant)', () => {
    const { coordinator } = harness();
    const popup = modal({ id: 'popup:1' as SurfaceId, tier: 'popup' });
    const picker = modal({ id: 'picker:1' as SurfaceId, tier: 'picker', focusable: false });
    coordinator.pushModal(popup);
    coordinator.pushModal(picker);

    const before = coordinator.snapshot().focus.stack;
    expect(before.indexOf('popup:1')).toBeLessThan(before.indexOf('picker:1'));

    // Raise popup — picker (higher tier) MUST stay above
    coordinator.raiseInTier('popup:1' as SurfaceId);
    const after = coordinator.snapshot().focus.stack;
    expect(after.indexOf('popup:1')).toBeLessThan(after.indexOf('picker:1'));
    expect(after.at(-1)).toBe('picker:1');
  });

  test('raising preserves lower-tier ordering (F6 invariant)', () => {
    const { coordinator } = harness();
    const dialog = modal({ id: 'dialog:1' as SurfaceId, tier: 'dialog' });
    const popupA = modal({ id: 'popup:a' as SurfaceId, tier: 'popup' });
    const popupB = modal({ id: 'popup:b' as SurfaceId, tier: 'popup' });
    coordinator.pushModal(dialog);
    coordinator.pushModal(popupA);
    coordinator.pushModal(popupB);

    coordinator.raiseInTier('popup:a' as SurfaceId);
    const stack = coordinator.snapshot().focus.stack;

    // Dialog (lower tier) stays at bottom
    expect(stack.indexOf('dialog:1')).toBeLessThan(stack.indexOf('popup:a'));
    expect(stack.indexOf('dialog:1')).toBeLessThan(stack.indexOf('popup:b'));
    // popup:a is now top of popup tier
    expect(stack.indexOf('popup:a')).toBeGreaterThan(stack.indexOf('popup:b'));
  });

  test('focus owner is NOT changed by raise (F10 invariant)', () => {
    const { coordinator } = harness();
    const a = modal({ id: 'popup:a' as SurfaceId, tier: 'popup' });
    const b = modal({ id: 'popup:b' as SurfaceId, tier: 'popup' });
    coordinator.pushModal(a);
    coordinator.pushModal(b);

    // pushModal sets focus on b (most recently focused)
    const focusBefore = coordinator.currentFocus();
    expect(focusBefore).toBe('popup:b');

    coordinator.raiseInTier('popup:a' as SurfaceId);

    // Raising should NOT mutate focus — that's a separate intent
    const focusAfter = coordinator.currentFocus();
    expect(focusAfter).toBe(focusBefore);
  });

  test('idempotent — raising already-top-of-tier returns false', () => {
    const { coordinator } = harness();
    const a = modal({ id: 'popup:a' as SurfaceId, tier: 'popup' });
    const b = modal({ id: 'popup:b' as SurfaceId, tier: 'popup' });
    coordinator.pushModal(a);
    coordinator.pushModal(b);

    // b is on top
    expect(coordinator.raiseInTier('popup:b' as SurfaceId)).toBe(false);
    expect(coordinator.snapshot().focus.stack.at(-1)).toBe('popup:b');
  });

  test('raise non-existent surface returns false', () => {
    const { coordinator } = harness();
    expect(coordinator.raiseInTier('does-not-exist' as SurfaceId)).toBe(false);
  });

  test('raise surface without tier returns false', () => {
    const { coordinator } = harness();
    // pushModal with tier-less surface
    const noTier = modal({ id: 'no-tier' as SurfaceId, tier: 'popup' });
    delete (noTier as Record<string, unknown>).tier;
    coordinator.pushModal(noTier as ModalSurface);
    expect(coordinator.raiseInTier('no-tier' as SurfaceId)).toBe(false);
  });

  test('three-popup raise from middle preserves the other two ordering', () => {
    const { coordinator } = harness();
    coordinator.pushModal(modal({ id: 'popup:a' as SurfaceId, tier: 'popup' }));
    coordinator.pushModal(modal({ id: 'popup:b' as SurfaceId, tier: 'popup' }));
    coordinator.pushModal(modal({ id: 'popup:c' as SurfaceId, tier: 'popup' }));

    coordinator.raiseInTier('popup:a' as SurfaceId);
    const stack = coordinator.snapshot().focus.stack;

    // a is top, b/c in their original push order between them
    expect(stack.at(-1)).toBe('popup:a');
    expect(stack.indexOf('popup:b')).toBeLessThan(stack.indexOf('popup:c'));
  });

  test('raising a non-focusable surface (e.g. picker) still works', () => {
    const { coordinator } = harness();
    const a = modal({ id: 'popup:a' as SurfaceId, tier: 'popup' });
    const pickerA = modal({ id: 'picker:a' as SurfaceId, tier: 'picker', focusable: false });
    const pickerB = modal({ id: 'picker:b' as SurfaceId, tier: 'picker', focusable: false });
    coordinator.pushModal(a);
    coordinator.pushModal(pickerA);
    coordinator.pushModal(pickerB);

    coordinator.raiseInTier('picker:a' as SurfaceId);
    const stack = coordinator.snapshot().focus.stack;
    expect(stack.at(-1)).toBe('picker:a');
    expect(stack.indexOf('popup:a')).toBeLessThan(stack.indexOf('picker:b'));
  });
});
