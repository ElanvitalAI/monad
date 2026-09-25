// Phase B-3a — each app-level modal type name is registered on the
// coordinator's ModalLifecycle at construction time. These tests pin
// the registry list so Phase B-3b/c caller migrations can rely on
// `modalLifecycleAPI().isTypeRegistered('attachment-popup')` etc.
// being true without needing to boot anything beyond the coordinator.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalBounds, ModalSurface } from '../src/display/modal-stack.js';
import {
  APP_MODAL_TYPES,
  registerAppModalTypes,
  type AppModalTypeName,
} from '../src/display/modal-types-registry.js';
import { createModalLifecycle } from '../src/primitives/modal-lifecycle/index.js';

function makeSurface(
  id: string,
  tier: ModalTier,
  bounds?: ModalBounds,
): ModalSurface {
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

describe('APP_MODAL_TYPES list integrity', () => {
  test('every declared name is unique', () => {
    const names = APP_MODAL_TYPES.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test('every tier is a legal ModalTier', () => {
    const legal: ReadonlySet<ModalTier> = new Set<ModalTier>([
      'vw', 'execution', 'terminal', 'dialog', 'popup', 'menu', 'picker', 'tooltip',
    ]);
    for (const t of APP_MODAL_TYPES) {
      expect(legal.has(t.tier)).toBe(true);
    }
  });

  test('names do not collide with the __coord-mirror:* namespace', () => {
    for (const t of APP_MODAL_TYPES) {
      expect(t.name.startsWith('__')).toBe(false);
    }
  });

  test('list covers the 8 core application modal kinds', () => {
    // Regression guard: the survey (B-3a prep) identified 8 core
    // modal kinds. Dropping one by accident would silently break
    // future caller migrations — pin them here.
    const names = new Set(APP_MODAL_TYPES.map((t) => t.name));
    const core: readonly AppModalTypeName[] = [
      'approval-dialog',
      'ask-user-question-modal',
      'slash-picker',
      'arg-picker',
      'at-picker',
      'search-modal',
      'interactive-terminal-modal',
      'attachment-popup',
    ];
    for (const c of core) expect(names.has(c)).toBe(true);
  });

  test('DragSession DS-3 / DS-4b consumer types are pre-registered', () => {
    // PR #306 PLAN-drag-session-primitive Ask #3 — register the
    // modal types DS-3 (drop-target-popover) and DS-4b
    // (copy-move-picker) need BEFORE those phases land, so the
    // consumers can push via typed API without an additional
    // registry edit. Same discipline as B-3a's "register once at
    // boot · caller touch 0" principle.
    const names = new Set(APP_MODAL_TYPES.map((t) => t.name));
    expect(names.has('copy-move-picker' as AppModalTypeName)).toBe(true);
    expect(names.has('drop-target-popover' as AppModalTypeName)).toBe(true);

    // Tier assignments — pinned so DragSession PLAN assumptions hold:
    // copy-move-picker sits in the picker tier (ambiguous drop modal);
    // drop-target-popover sits in the popup tier (ephemeral highlight).
    const copyMove = APP_MODAL_TYPES.find((t) => t.name === 'copy-move-picker');
    const dropPopover = APP_MODAL_TYPES.find((t) => t.name === 'drop-target-popover');
    expect(copyMove?.tier).toBe('picker');
    expect(dropPopover?.tier).toBe('popup');
  });
});

describe('DisplayCoordinator — app-level types auto-registered', () => {
  test('every APP_MODAL_TYPES entry is registered after construction', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    for (const t of APP_MODAL_TYPES) {
      expect(mlc.isTypeRegistered(t.name)).toBe(true);
    }
  });

  test('app types coexist with __coord-mirror:* types', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    // Mirror types from B-2 still registered.
    for (const tier of ['dialog', 'popup', 'picker', 'menu', 'tooltip', 'terminal'] as const) {
      expect(mlc.isTypeRegistered(`__coord-mirror:${tier}`)).toBe(true);
    }
    // Spot-check a few named types.
    expect(mlc.isTypeRegistered('attachment-popup')).toBe(true);
    expect(mlc.isTypeRegistered('approval-dialog')).toBe(true);
    expect(mlc.isTypeRegistered('slash-picker')).toBe(true);
  });

  test('unknown type names still report false (no accidental wildcard)', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    expect(mlc.isTypeRegistered('totally-not-registered')).toBe(false);
    expect(mlc.isTypeRegistered('popup')).toBe(false);
    expect(mlc.isTypeRegistered('dialog')).toBe(false);
  });
});

describe('app-level push via modalLifecycleAPI (B-3b preview)', () => {
  test('push("attachment-popup", opts, surface) produces a handle with correct tier', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    const surface = makeSurface('attach-popup-instance', 'popup');

    const handle = mlc.push(
      'attachment-popup',
      { idempotencyKey: 'attach-popup-instance' },
      surface,
    );

    expect(handle).not.toBeNull();
    expect(handle!.tier).toBe('popup');
    expect(handle!.typeName).toBe('attachment-popup');
    expect(handle!.surface).toBe(surface);
  });

  test('push("approval-dialog", ...) returns dialog-tier handle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    const surface = makeSurface('approval-1', 'dialog');

    const handle = mlc.push(
      'approval-dialog',
      { idempotencyKey: 'approval-1' },
      surface,
    );

    expect(handle!.tier).toBe('dialog');
    expect(handle!.typeName).toBe('approval-dialog');
  });

  test('push("slash-picker", ...) returns picker-tier handle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    const surface = makeSurface('slash-1', 'picker');

    const handle = mlc.push(
      'slash-picker',
      { idempotencyKey: 'slash-1' },
      surface,
    );

    expect(handle!.tier).toBe('picker');
    expect(handle!.typeName).toBe('slash-picker');
  });

  test('passthrough factory returns the caller-supplied surface verbatim', () => {
    // Pins the B-3a design invariant: app-level factories are pass-
    // through. If B-3b ever flips one of these to a real declarative
    // factory (e.g. attachment-popup), this test will still pass for
    // the passthrough ones but the migrated type would fail the
    // `handle.surface === surface` check (which we don't run on it).
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    const surface = makeSurface('passthrough-1', 'popup');

    const handle = mlc.push(
      'attachment-popup',
      { idempotencyKey: 'passthrough-1' },
      surface,
    );

    expect(handle!.surface).toBe(surface);
    expect(handle!.surface.id).toBe('passthrough-1');
  });

  test('duplicate push with same idempotency key replaces (primitive default policy)', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    const s1 = makeSurface('dup-1', 'dialog');
    const s2 = makeSurface('dup-1', 'dialog');

    const h1 = mlc.push('approval-dialog', { idempotencyKey: 'dup-1' }, s1);
    const h2 = mlc.push('approval-dialog', { idempotencyKey: 'dup-1' }, s2);

    expect(h1!.isDisposed()).toBe(true);
    expect(h2!.isDisposed()).toBe(false);
    // Only the newer handle is live.
    const live = mlc.stackOrder().filter((h) => !h.isDisposed());
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(h2!);
  });
});

describe('registerAppModalTypes — standalone', () => {
  test('throws on double-registration (primitive name-uniqueness guard)', () => {
    // Phase B-3a invariant: callers MUST register each lifecycle
    // instance exactly once. The primitive throws on duplicates; we
    // pin that here so a future refactor that silently skips the
    // duplicate would be caught.
    const mlc = createModalLifecycle();
    registerAppModalTypes(mlc);
    expect(() => registerAppModalTypes(mlc)).toThrow();
  });

  test('works on a freshly-created ModalLifecycle without a coordinator', () => {
    // Lets test harnesses and plugin hosts share the same registry
    // without instantiating a full DisplayCoordinator.
    const mlc = createModalLifecycle();
    for (const t of APP_MODAL_TYPES) {
      expect(mlc.isTypeRegistered(t.name)).toBe(false);
    }
    registerAppModalTypes(mlc);
    for (const t of APP_MODAL_TYPES) {
      expect(mlc.isTypeRegistered(t.name)).toBe(true);
    }
  });
});

describe('coordinator.pushModal — B-2 mirror path still used', () => {
  test('coord.pushModal(surface) still routes via __coord-mirror, not app types', () => {
    // B-3a is additive: even after app types are registered, the
    // legacy pushModal path (B-2 mirror) is unchanged. Caller
    // migration is B-3b scope.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();
    const surface = makeSurface('legacy-path-check', 'popup');

    coordinator.pushModal(surface);

    const order = mlc.stackOrder();
    expect(order).toHaveLength(1);
    // The live handle's typeName comes from the mirror type, NOT
    // from an app-level type.
    expect(order[0]!.typeName).toBe('__coord-mirror:popup');
  });
});
