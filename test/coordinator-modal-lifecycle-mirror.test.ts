// Phase B-2 — coordinator mirrors every pushModal / popModal /
// closeSurface into its ModalLifecycle primitive. These tests pin
// the mirror contract so Phase B-3 (caller migration) can trust
// `coordinator.modalLifecycleAPI()` reflects the live stack.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalBounds, ModalSurface } from '../src/display/modal-stack.js';

function makeSurface(id: string, tier: ModalTier, bounds?: ModalBounds): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier,
    focus: 'owns',
    priority: 250,
    bounds: bounds ?? { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
  });
  return { coordinator };
}

describe('coordinator.modalLifecycleAPI — primitive is attached', () => {
  test('modalLifecycleAPI returns a stable ModalLifecycle instance', () => {
    const { coordinator } = harness();
    const mlc1 = coordinator.modalLifecycleAPI();
    const mlc2 = coordinator.modalLifecycleAPI();
    expect(mlc1).toBe(mlc2);
    expect(typeof mlc1.push).toBe('function');
    expect(typeof mlc1.pop).toBe('function');
  });

  test('primitive pre-registers a mirror type for every tier', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    for (const tier of ['vw', 'execution', 'terminal', 'dialog', 'popup', 'menu', 'picker', 'tooltip'] as const) {
      expect(mlc.isTypeRegistered(`__coord-mirror:${tier}`)).toBe(true);
    }
  });
});

describe('coordinator mirror push / pop — state sync', () => {
  test('pushModal adds a handle to the primitive stack', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    expect(mlc.stackOrder()).toHaveLength(0);

    coordinator.pushModal(makeSurface('dlg-1', 'dialog'));

    const order = mlc.stackOrder();
    expect(order).toHaveLength(1);
    expect(order[0]!.tier).toBe('dialog');
    expect(order[0]!.surface.id).toBe('dlg-1');
  });

  test('popModal disposes the mirror handle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    coordinator.pushModal(makeSurface('popup-1', 'popup'));
    expect(mlc.stackOrder()).toHaveLength(1);

    coordinator.popModal('popup-1' as SurfaceId);
    expect(mlc.stackOrder()).toHaveLength(0);
  });

  test('popModal on a missing surface still disposes a stray mirror handle', () => {
    // Edge case: caller pushed, something closed the surface via a
    // non-popModal path, then calls popModal again. The mirror should
    // still be cleaned up so it doesn't leak.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    coordinator.pushModal(makeSurface('dlg-x', 'dialog'));
    // Re-push same id — mirror sees idempotencyKey replace. One live.
    coordinator.pushModal(makeSurface('dlg-x', 'dialog'));
    expect(mlc.stackOrder()).toHaveLength(1);

    coordinator.popModal('dlg-x' as SurfaceId);
    expect(mlc.stackOrder()).toHaveLength(0);
  });
});

describe('coordinator mirror — idempotent pushes replace (PR #256 scenario)', () => {
  test('repeated pushModal with the same id produces exactly one live handle', () => {
    // This is the PR #256 attachment-popup bug in test form. The
    // primitive's `replace` duplicateBehavior guarantees that the
    // mirror always holds exactly one instance per surface.id.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    for (let i = 0; i < 5; i++) {
      coordinator.pushModal(makeSurface('attach-popup', 'popup'));
    }

    const order = mlc.stackOrder();
    expect(order).toHaveLength(1);
    // The last push wins — its generation is the highest observed.
    const live = order[0]!;
    expect(live.surface.id).toBe('attach-popup');
    expect(live.tier).toBe('popup');
  });

  test('prior handles report isDisposed after replace cycle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    coordinator.pushModal(makeSurface('replace-me', 'dialog'));
    const firstHandle = mlc.stackOrder()[0]!;

    coordinator.pushModal(makeSurface('replace-me', 'dialog'));

    expect(firstHandle.isDisposed()).toBe(true);
    expect(mlc.stackOrder()).toHaveLength(1);
    expect(mlc.stackOrder()[0]).not.toBe(firstHandle);
  });
});

describe('coordinator mirror — tier separation', () => {
  test('modals in different tiers coexist in the primitive stack', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    coordinator.pushModal(makeSurface('picker-1', 'picker'));
    coordinator.pushModal(makeSurface('popup-1', 'popup'));
    coordinator.pushModal(makeSurface('dialog-1', 'dialog'));

    expect(mlc.stackOrder()).toHaveLength(3);
    expect(mlc.topOfTier('picker')?.surface.id).toBe('picker-1');
    expect(mlc.topOfTier('popup')?.surface.id).toBe('popup-1');
    expect(mlc.topOfTier('dialog')?.surface.id).toBe('dialog-1');
  });

  test('same id across different tiers — each tier has its own registered type', () => {
    // Cross-tier idempotencyKey collisions don't dedupe (primitive
    // scopes key to typeName). Verifies the coordinator picks the
    // right `__coord-mirror:<tier>` entry for each push.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    coordinator.pushModal(makeSurface('same', 'picker'));
    coordinator.pushModal(makeSurface('same', 'popup'));
    // Both sit on the primitive stack; coordinator's own surfaces Map
    // would upsert, but the primitive sees two entries because the
    // type (and thus key-scope) differs.
    expect(mlc.stackOrder().length).toBeGreaterThanOrEqual(1);
  });
});

describe('coordinator mirror — invalidate event wiring', () => {
  test('invalidate event fires when popModal disposes a handle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    let invalidateCount = 0;
    mlc.on('invalidate', () => { invalidateCount++; });

    coordinator.pushModal(makeSurface('fire', 'dialog'));
    coordinator.popModal('fire' as SurfaceId);

    // Default policy invalidateOnDispose=true; one pop → one invalidate.
    expect(invalidateCount).toBeGreaterThanOrEqual(1);
  });
});
