// Phase B-3b — coordinator reverse-wiring for typed (non-mirror)
// primitive pushes. Callers using `modalLifecycleAPI().push('<type>',
// opts, surface)` directly (bypassing coord.pushModal) now get the
// full coord-side cascade (surface registry + focus + paint
// invalidate + frame request) driven by primitive events. These
// tests pin that contract so B-3c can trust typed push works end-
// to-end without the dashboard calling display.pushModal.

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalBounds, ModalSurface } from '../src/display/modal-stack.js';

function makeSurface(
  id: string,
  tier: ModalTier,
  overrides: Partial<ModalSurface> = {},
): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier,
    focus: 'owns',
    priority: 250,
    bounds: { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
    ...overrides,
  };
}

function harness() {
  const scheduled: Array<() => void> = [];
  const invalidatedRows: number[] = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    invalidateRow: (r) => { invalidatedRows.push(r); },
    regionMap: {
      resolve: (surface) => ({
        startRow: surface.bounds.row,
        endRow: surface.bounds.row + surface.bounds.height - 1,
      }),
    },
    termSize: () => ({ rows: 30, cols: 80 }),
  });
  return { coordinator, scheduled, invalidatedRows };
}

describe('typed push — mounted event reverse-wiring', () => {
  test('typed push registers surface in coord.surfaces', () => {
    const { coordinator } = harness();
    const surface = makeSurface('attach-1', 'popup');

    coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'log-attachment-popup' },
      surface,
    );

    expect(coordinator.surface('attach-1' as SurfaceId)).toBe(surface);
  });

  test('typed push updates currentFocus for focusable surfaces', () => {
    const { coordinator } = harness();
    const surface = makeSurface('focusable-1', 'popup', { focus: 'owns' });

    coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'focusable-1' },
      surface,
    );

    expect(coordinator.currentFocus()).toBe('focusable-1');
  });

  test('typed push with focusable:false appends to stack without shifting active', () => {
    const { coordinator } = harness();
    // Register a focusable surface first so we can observe active
    // doesn't shift to the non-focusable push.
    const anchor = makeSurface('anchor', 'dialog', { focus: 'owns' });
    coordinator.pushModal(anchor);
    expect(coordinator.currentFocus()).toBe('anchor');

    const picker = makeSurface('picker-nf', 'picker', { focus: 'none' });
    coordinator.modalLifecycleAPI().push(
      'slash-picker',
      { idempotencyKey: 'picker-nf' },
      picker,
    );

    // Active unchanged; non-focusable surface on stack (paint-only).
    expect(coordinator.currentFocus()).toBe('anchor');
    expect(coordinator.modalStack()).toContain('picker-nf');
  });

  test('typed push wires focus manager primitive (F-2 mirror)', () => {
    const { coordinator } = harness();
    const surface = makeSurface('fm-1', 'popup', { focus: 'owns' });
    coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'fm-1' },
      surface,
    );
    // Primitive focus manager sees the node and marks it active.
    expect(coordinator.focusManagerAPI().isRegistered('fm-1' as SurfaceId)).toBe(true);
    expect(coordinator.focusManagerAPI().active()?.id).toBe('fm-1');
  });
});

describe('typed push — disposed event reverse-wiring', () => {
  test('disposing the primitive handle closes the coord surface', () => {
    const { coordinator } = harness();
    const surface = makeSurface('dispose-1', 'popup');

    const handle = coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'dispose-1' },
      surface,
    );
    expect(coordinator.surface('dispose-1' as SurfaceId)).toBe(surface);

    handle!.dispose();

    expect(coordinator.surface('dispose-1' as SurfaceId)).toBeNull();
    expect(coordinator.focusManagerAPI().isRegistered('dispose-1' as SurfaceId)).toBe(false);
  });

  test('disposing the primitive handle clears primitive active focus', () => {
    const { coordinator } = harness();
    const surface = makeSurface('active-dispose', 'popup', { focus: 'owns' });
    const handle = coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'active-dispose' },
      surface,
    );
    expect(coordinator.focusManagerAPI().active()?.id).toBe('active-dispose');

    handle!.dispose();

    expect(coordinator.focusManagerAPI().active()).toBeNull();
  });

  test('disposing the primitive handle triggers region invalidation', () => {
    const { coordinator, invalidatedRows } = harness();
    const surface = makeSurface('invalidate-1', 'popup', {
      bounds: { row: 5, col: 1, width: 10, height: 3 },
    });
    const handle = coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'invalidate-1' },
      surface,
    );

    const before = invalidatedRows.length;
    handle!.dispose();

    // closeSurface invalidates the surface's row range via regionMap.
    // Rows are 0-indexed after RowRange.startRow-1 → so rows 4,5,6.
    expect(invalidatedRows.length).toBeGreaterThan(before);
  });
});

describe('typed push — idempotency (replace policy)', () => {
  test('repeated push with same idempotencyKey keeps exactly one live handle', () => {
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    const s1 = makeSurface('attach-first', 'popup');
    const s2 = makeSurface('attach-second', 'popup');
    const s3 = makeSurface('attach-third', 'popup');

    const h1 = mlc.push('attachment-popup', { idempotencyKey: 'log-attachment-popup' }, s1);
    const h2 = mlc.push('attachment-popup', { idempotencyKey: 'log-attachment-popup' }, s2);
    const h3 = mlc.push('attachment-popup', { idempotencyKey: 'log-attachment-popup' }, s3);

    expect(h1!.isDisposed()).toBe(true);
    expect(h2!.isDisposed()).toBe(true);
    expect(h3!.isDisposed()).toBe(false);

    const live = mlc.stackOrder().filter((h) => !h.isDisposed());
    expect(live).toHaveLength(1);
    expect(live[0]).toBe(h3!);
  });

  test('replaced handle triggers closeSurface before new handle mounts', () => {
    // B-3b invariant: the 'replace' flow emits disposed (→ closeSurface)
    // BEFORE the new mount event fires. Verified by checking that
    // coord.surfaces only ever holds the current surface.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    const s1 = makeSurface('swap-1', 'popup');
    mlc.push('attachment-popup', { idempotencyKey: 'swap-key' }, s1);
    expect(coordinator.surface('swap-1' as SurfaceId)).toBe(s1);

    const s2 = makeSurface('swap-2', 'popup');
    mlc.push('attachment-popup', { idempotencyKey: 'swap-key' }, s2);

    // The swap-1 surface is gone; swap-2 is present.
    expect(coordinator.surface('swap-1' as SurfaceId)).toBeNull();
    expect(coordinator.surface('swap-2' as SurfaceId)).toBe(s2);
  });
});

describe('typed push — attachment popup key routing', () => {
  test('routeKey drives SelectView navigation for a typed attachment popup', async () => {
    const { coordinator } = harness();
    const { createAttachmentPopup } = await import('../src/log-pane/attachment-popup.js');

    const picked: string[] = [];
    const popup = createAttachmentPopup({
      attachment: {
        id: 6,
        kind: 'md',
        token: '[Md #6]',
        sourcePath: '/project/monad-agent/MANUAL.md',
        filename: 'MANUAL.md',
        sizeBytes: 20_684,
        mtime: 1,
        pastedAt: 1,
        loaded: false,
      },
      col: 8,
      row: 10,
      termCols: 120,
      termRows: 40,
      onAction: (action) => { picked.push(action); },
    });

    coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'log-attachment-popup' },
      popup.surface,
    );

    const move = coordinator.routeKey({ name: 'down' });
    const submit = coordinator.routeKey({ name: 'enter' });

    expect(move.type).toBe('consumed');
    expect(submit.type).toBe('consumed');
    expect(picked).toEqual(['copy-token']);
  });

  test('tryRouteKeyToTopModalAsync drives the same popup while input mode is active', async () => {
    const { coordinator } = harness();
    const { createAttachmentPopup } = await import('../src/log-pane/attachment-popup.js');

    const picked: string[] = [];
    const popup = createAttachmentPopup({
      attachment: {
        id: 6,
        kind: 'md',
        token: '[Md #6]',
        sourcePath: '/project/monad-agent/MANUAL.md',
        filename: 'MANUAL.md',
        sizeBytes: 20_684,
        mtime: 1,
        pastedAt: 1,
        loaded: false,
      },
      col: 8,
      row: 10,
      termCols: 120,
      termRows: 40,
      onAction: (action) => { picked.push(action); },
    });

    coordinator.modalLifecycleAPI().push(
      'attachment-popup',
      { idempotencyKey: 'log-attachment-popup' },
      popup.surface,
    );

    expect(await coordinator.tryRouteKeyToTopModalAsync({ name: 'down' })).toBe('consumed');
    expect(await coordinator.tryRouteKeyToTopModalAsync({ name: 'enter' })).toBe('consumed');
    expect(picked).toEqual(['copy-token']);
  });
});

describe('mirror path (B-2) — unchanged by B-3b reverse-wiring', () => {
  test('coord.pushModal still registers surface + focus without duplication', () => {
    const { coordinator } = harness();
    const surface = makeSurface('mirror-1', 'popup');

    coordinator.pushModal(surface);

    expect(coordinator.surface('mirror-1' as SurfaceId)).toBe(surface);
    expect(coordinator.currentFocus()).toBe('mirror-1');
    const order = coordinator.modalLifecycleAPI().stackOrder();
    expect(order).toHaveLength(1);
    // Mirror path — primitive handle uses __coord-mirror typeName,
    // NOT the app-level 'attachment-popup'. B-3b reverse-wiring
    // skips mirror mounts (coord.pushModal already did the work).
    expect(order[0]!.typeName).toBe('__coord-mirror:popup');
  });

  test('coord.popModal still cleans up without double-closing on disposed event', () => {
    const { coordinator } = harness();
    coordinator.pushModal(makeSurface('mirror-pop', 'popup'));
    expect(coordinator.surface('mirror-pop' as SurfaceId)).not.toBeNull();

    coordinator.popModal('mirror-pop' as SurfaceId);

    // Single close path — no "surface gone twice" error (would throw
    // in closeSurface's debug logging if re-entered with missing
    // surface, because closeSurface.miss path logs and returns).
    expect(coordinator.surface('mirror-pop' as SurfaceId)).toBeNull();
  });
});

describe('modal-adapter.ts — surface.dispose + handle.dispose unified cleanup (B-3b Part 1)', () => {
  // These assertions are structural — we can't easily observe the
  // drag machine from here, but we can verify the disposed flag is
  // shared and that either entry point triggers spec.onDispose.
  //
  // Full drag/ctx-key end-to-end verification lives in modal-adapter
  // unit tests; here we guard the invariant that matters for B-3b's
  // primitive-driven dispose: calling surface.dispose produces the
  // same cleanup as calling handle.dispose.

  test('surface.dispose triggers spec.onDispose (coord path)', async () => {
    const { mountViewAsModalSurface } = await import('../src/ui/modal-adapter.js');
    const { SelectView } = await import('../src/ui/widgets/select-view.js');

    let onDisposeCalls = 0;
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'unified-1' as SurfaceId,
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
      tier: 'popup',
      onDispose: () => { onDisposeCalls++; },
    });

    // Simulate coord closeSurface calling surface.dispose
    h.surface.dispose?.();

    expect(onDisposeCalls).toBe(1);
    expect(h.isDisposed()).toBe(true);

    // Second surface.dispose is a no-op (idempotent)
    h.surface.dispose?.();
    expect(onDisposeCalls).toBe(1);

    // handle.dispose also idempotent after surface.dispose
    h.dispose();
    expect(onDisposeCalls).toBe(1);
  });

  test('handle.dispose triggers spec.onDispose (caller path)', async () => {
    const { mountViewAsModalSurface } = await import('../src/ui/modal-adapter.js');
    const { SelectView } = await import('../src/ui/widgets/select-view.js');

    let onDisposeCalls = 0;
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({
      id: 'unified-2' as SurfaceId,
      bounds: { row: 1, col: 1, width: 10, height: 3 },
      view,
      tier: 'popup',
      onDispose: () => { onDisposeCalls++; },
    });

    h.dispose();

    expect(onDisposeCalls).toBe(1);
    expect(h.isDisposed()).toBe(true);

    // Calling surface.dispose after handle.dispose is a no-op
    h.surface.dispose?.();
    expect(onDisposeCalls).toBe(1);
  });
});
