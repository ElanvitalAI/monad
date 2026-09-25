// Phase F-2 — coordinator mirrors every registerFocusNode / setFocus
// / cycleFocus / clearFocus into its FocusManager primitive. These
// tests pin the mirror contract so Phase F-3 (37 setFocus caller
// migration) can trust `coordinator.focusManagerAPI()` reflects the
// live focus state. Pattern mirrors coordinator-modal-lifecycle-mirror
// .test.ts (B-2).

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { FocusNode, SurfaceId } from '../src/display/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeModalSurface(id: string, focusable: boolean = true): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier: 'dialog',
    focus: focusable ? 'owns' : 'none',
    priority: 250,
    bounds: { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
  };
}

function makeFocusNode(id: string, overrides: Partial<FocusNode> = {}): FocusNode {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    focusable: true,
    scope: 'dashboard',
    order: 10,
    ...overrides,
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

describe('coordinator.focusManagerAPI — primitive is attached', () => {
  test('focusManagerAPI returns a stable FocusManager instance', () => {
    const { coordinator } = harness();
    const fm1 = coordinator.focusManagerAPI();
    const fm2 = coordinator.focusManagerAPI();
    expect(fm1).toBe(fm2);
    expect(typeof fm1.register).toBe('function');
    expect(typeof fm1.setFocus).toBe('function');
    expect(typeof fm1.cycle).toBe('function');
  });

  test('default policy is "priority" (matches coordinator legacy behavior)', () => {
    const { coordinator } = harness();
    expect(coordinator.focusManagerAPI().policy).toBe('priority');
  });
});

describe('coordinator mirror — registerFocusNode / dispose', () => {
  test('registerFocusNode mirrors the node onto the primitive', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    const handle = coordinator.handle('dashboard');
    const reg = handle.registerFocus({
      id: 'widget:alpha' as SurfaceId,
      focusable: true,
      scope: 'plugin',
      order: 20,
    });
    expect(fm.isRegistered('widget:alpha' as SurfaceId)).toBe(true);

    reg.dispose();
    expect(fm.isRegistered('widget:alpha' as SurfaceId)).toBe(false);
  });

  test('direct registerFocusNode re-registration upserts on the primitive', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    // Direct call bypasses the handle wrapper; exercises the bare
    // `registerFocusNode` path + F-2 mirror's unregister-before-reregister.
    const first = coordinator.registerFocusNode(
      makeFocusNode('scope:a', { order: 10 }),
    );
    expect(fm.isRegistered('scope:a' as SurfaceId)).toBe(true);
    // Re-register with different priority — mirror drops the prior
    // entry and installs the new one. Primitive's register would
    // otherwise throw on duplicate id.
    first.dispose();
    coordinator.registerFocusNode(
      makeFocusNode('scope:a', { order: 99 }),
    );
    expect(fm.isRegistered('scope:a' as SurfaceId)).toBe(true);
    // The primitive's view of the node reflects the latest registration.
    const snap = [...fm.focusableInScope('dashboard')].find(
      (n) => n.id === ('scope:a' as SurfaceId),
    );
    expect(snap?.priority).toBe(99);
  });
});

describe('coordinator mirror — setFocus', () => {
  test('pushModal sets primitive active via the setFocus mirror', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    coordinator.pushModal(makeModalSurface('dlg-1'));

    expect(fm.active()?.id).toBe('dlg-1');
    expect(coordinator.currentFocus()).toBe('dlg-1');
  });

  test('coord currentFocus and primitive active() stay aligned across transitions', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    coordinator.pushModal(makeModalSurface('dlg-1'));
    coordinator.pushModal(makeModalSurface('dlg-2'));

    expect(coordinator.currentFocus()).toBe('dlg-2');
    expect(fm.active()?.id).toBe('dlg-2');
    expect(fm.previous()?.id).toBe('dlg-1');
  });

  test('setFocus via handle publish mirrors to primitive', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    const handle = coordinator.handle('dashboard');
    handle.registerFocus({
      id: 'scope:b' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });
    handle.focus('scope:b' as SurfaceId);

    expect(fm.active()?.id).toBe('scope:b');
  });

  test('primitive emits `focused` event on every coord setFocus', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    const seen: Array<{ id: string | null; reason: string }> = [];
    fm.on('focused', (ev) => {
      seen.push({ id: ev.node?.id ?? null, reason: ev.reason });
    });

    coordinator.pushModal(makeModalSurface('dlg-evt'));

    const dlg = seen.find((s) => s.id === 'dlg-evt');
    expect(dlg).toBeDefined();
    // The coord setFocus reason is 'modal:push' (pushModal uses it).
    expect(dlg!.reason).toBe('modal:push');
  });
});

describe('coordinator mirror — cycleFocus piggybacks on setFocus', () => {
  test('cycleFocus updates primitive active via the shared setFocus mirror', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    const handle = coordinator.handle('dashboard');
    handle.registerFocus({
      id: 'node:a' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });
    handle.registerFocus({
      id: 'node:b' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 20,
    });

    handle.focus('node:a' as SurfaceId);
    expect(fm.active()?.id).toBe('node:a');

    const nextId = coordinator.cycleFocus('dashboard', 1);
    expect(nextId).toBe('node:b');
    expect(fm.active()?.id).toBe('node:b');
  });
});

describe('coordinator mirror — closeSurface / popModal unregister', () => {
  test('popModal unregisters the focus node on the primitive', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    coordinator.pushModal(makeModalSurface('dlg-dispose'));
    expect(fm.isRegistered('dlg-dispose' as SurfaceId)).toBe(true);

    coordinator.popModal('dlg-dispose' as SurfaceId);
    expect(fm.isRegistered('dlg-dispose' as SurfaceId)).toBe(false);
  });

  test('closing the focused surface clears primitive active atomically', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();

    coordinator.pushModal(makeModalSurface('dlg-close'));
    expect(fm.active()?.id).toBe('dlg-close');

    coordinator.popModal('dlg-close' as SurfaceId);
    expect(fm.active()).toBeNull();
  });
});

describe('coordinator mirror — ModalLifecycle event bridge', () => {
  test('mounted event auto-registers when caller skips coord.pushModal', () => {
    // Path exercised: a caller uses modalLifecycleAPI() directly
    // (e.g. a plugin pushing via the primitive without touching
    // coordinator.pushModal). The F-2 wiring should still install
    // the focus entry so downstream setFocus has a target.
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();
    const mlc = coordinator.modalLifecycleAPI();

    const surface = makeModalSurface('raw-mount');
    const handle = mlc.push('__coord-mirror:dialog', {
      idempotencyKey: 'raw-mount',
    }, surface);

    expect(handle).not.toBeNull();
    expect(fm.isRegistered('raw-mount' as SurfaceId)).toBe(true);
    // surface.focus === 'owns' → mount listener calls setFocus
    expect(fm.active()?.id).toBe('raw-mount');
  });

  test('disposed event unregisters the focus node', () => {
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();
    const mlc = coordinator.modalLifecycleAPI();

    const handle = mlc.push('__coord-mirror:dialog', {
      idempotencyKey: 'raw-dispose',
    }, makeModalSurface('raw-dispose'));
    expect(fm.isRegistered('raw-dispose' as SurfaceId)).toBe(true);

    handle!.dispose();
    expect(fm.isRegistered('raw-dispose' as SurfaceId)).toBe(false);
  });
});

describe('coordinator mirror — FocusNodeRef id naming (Session C §14.2)', () => {
  test('arbitrary SurfaceId shapes are accepted as FocusNodeRef.id', () => {
    // Session C §14.2 asked that the primitive not enforce an id
    // format on register. Verify a few representative shapes we use
    // in the wild go through unmodified.
    const { coordinator } = harness();
    const fm = coordinator.focusManagerAPI();
    const handle = coordinator.handle('plugin:demo');

    const ids = [
      'widget:alpha',
      'plugin:demo:popup',
      'terminal#42',
      '__coord-mirror:picker',
    ];
    for (const id of ids) {
      handle.registerFocus({
        id: id as SurfaceId,
        focusable: true,
        scope: 'plugin',
        order: 10,
      });
      expect(fm.isRegistered(id as SurfaceId)).toBe(true);
    }
  });
});

describe('coordinator mirror — mounted event order (Session C §14.2)', () => {
  test('mounted event fires after push returns a handle (current impl)', () => {
    // Session C §14.2 asked that `mounted` be observable after the
    // handle has been assigned id/generation. The B-2 mirror emits
    // mounted during `push(...)`, so subscribers receive it before
    // `push(...)` resolves — which is the current contract the
    // F-2 wiring relies on. This test pins that ordering.
    const { coordinator } = harness();
    const mlc = coordinator.modalLifecycleAPI();

    let observedSurfaceIdAtMount: string | null = null;
    let observedHandleIdAtMount: string | null = null;
    mlc.on('mounted', (ev) => {
      // By the time the listener runs, ev.handle has a fully-formed
      // synthetic id + generation pair AND ev.handle.surface.id is
      // set. The F-2 wiring keys on `handle.surface.id`, so the test
      // pins both shapes — a regression that null'd out either side
      // during mount would break focus register downstream.
      observedSurfaceIdAtMount = ev.handle.surface.id;
      observedHandleIdAtMount = ev.handle.id;
    });

    coordinator.pushModal(makeModalSurface('order-check'));
    expect(observedSurfaceIdAtMount).toBe('order-check');
    // Synthetic handle.id format pinned by primitive's mintSurfaceId:
    // `<typeName>#g<base36-generation>`. Match the prefix.
    expect(observedHandleIdAtMount).toMatch(/^__coord-mirror:dialog#g/);
  });
});
