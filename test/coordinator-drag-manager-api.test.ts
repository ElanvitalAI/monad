// Phase DS-2b — coordinator exposes DragManager primitive via
// `dragManagerAPI()` + auto-cancels any active session when a new
// modal mounts. Pattern matches `modalLifecycleAPI()` and
// `focusManagerAPI()` naming for cross-primitive consistency.
//
// This PR is the Session B half of the joint DS-2 split:
//   - DS-2a (PR #319): src/display/drag-dispatch.ts adapter
//   - DS-2b (this PR): coord getter + modal-cancel subscription +
//                      dashboard wiring hook

import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalTier, SurfaceId } from '../src/display/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import { payload } from '../src/primitives/drag-session/index.js';

function makeModalSurface(id: string, tier: ModalTier = 'dialog'): ModalSurface {
  return {
    id: id as SurfaceId,
    owner: 'dashboard',
    kind: 'modal',
    tier,
    focusable: true,
    priority: 250,
    bounds: { row: 1, col: 1, width: 10, height: 5 },
    render: () => [],
    paint: () => '',
  };
}

function harness() {
  const coordinator = new DisplayCoordinator({ frameMs: 16 });
  return { coordinator };
}

describe('coordinator.dragManagerAPI — primitive attach', () => {
  test('returns a stable DragManager instance', () => {
    const { coordinator } = harness();
    const dm1 = coordinator.dragManagerAPI();
    const dm2 = coordinator.dragManagerAPI();
    expect(dm1).toBe(dm2);
    expect(typeof dm1.begin).toBe('function');
    expect(typeof dm1.isActive).toBe('function');
    expect(typeof dm1.handleMouse).toBe('function');
    expect(typeof dm1.cancelAll).toBe('function');
  });

  test('fresh coord — no active session by default', () => {
    const { coordinator } = harness();
    expect(coordinator.dragManagerAPI().isActive()).toBe(false);
    expect(coordinator.dragManagerAPI().current()).toBeNull();
  });

  test('begin a session and verify active state flows through getter', () => {
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();
    dm.begin({
      source: 'pane:src' as SurfaceId,
      button: 'left',
      payload: payload([['file-path[]', ['/a']]]),
      startAt: { row: 3, col: 5 },
    });
    expect(dm.isActive()).toBe(true);
    expect(dm.current()?.source).toBe('pane:src');
  });
});

describe('coordinator — modal push cancels active drag (DS-2b safety)', () => {
  test('pushModal with active drag fires cancelAll', () => {
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();

    const cancelReasons: string[] = [];
    dm.on('cancel', (ev) => { cancelReasons.push(ev.reason); });

    dm.begin({
      source: 'src' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    expect(dm.isActive()).toBe(true);

    // pushModal through coord → mirrorPushToPrimitive → primitive
    // 'mounted' event → DS-2b subscription cancels drag.
    coordinator.pushModal(makeModalSurface('alert-1'));

    expect(dm.isActive()).toBe(false);
    expect(cancelReasons).toContain('modal-mounted');
  });

  test('typed primitive push also cancels drag via mounted event', () => {
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();
    const mlc = coordinator.modalLifecycleAPI();

    dm.begin({
      source: 'src' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    expect(dm.isActive()).toBe(true);

    // Typed push bypasses coord.pushModal but still fires mounted.
    mlc.push(
      'attachment-popup',
      { idempotencyKey: 'ap' },
      makeModalSurface('ap-1', 'popup'),
    );

    expect(dm.isActive()).toBe(false);
  });

  test('modal push WITHOUT active drag is a no-op (no spurious cancel)', () => {
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();

    const cancelEvents: string[] = [];
    dm.on('cancel', (ev) => { cancelEvents.push(ev.reason); });

    coordinator.pushModal(makeModalSurface('nothing-active'));
    // No drag was active → no cancel event should fire.
    expect(cancelEvents).toHaveLength(0);
  });

  test('drag survives focus changes unrelated to modal lifecycle', () => {
    // Push a modal via the `handle(...).focus(...)` path (not pushModal).
    // The mounted event is what triggers cancel — a raw setFocus call
    // on an existing surface doesn't mount a new modal so drag persists.
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();

    const h = coordinator.handle('dashboard');
    h.registerFocus({ id: 'f:a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    h.registerFocus({ id: 'f:b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });

    dm.begin({
      source: 'src' as SurfaceId,
      button: 'left',
      payload: payload([['k', 'v']]),
      startAt: { row: 0, col: 0 },
    });
    h.focus('f:a' as SurfaceId);
    h.focus('f:b' as SurfaceId);
    expect(dm.isActive()).toBe(true);
  });
});

describe('coordinator — naming consistency with sibling primitives', () => {
  test('all three primitive getters exist and return distinct instances', () => {
    const { coordinator } = harness();
    const modal = coordinator.modalLifecycleAPI();
    const focus = coordinator.focusManagerAPI();
    const drag = coordinator.dragManagerAPI();
    expect(modal).not.toBe(focus);
    expect(focus).not.toBe(drag);
    expect(modal).not.toBe(drag);
  });

  test('getter is idempotent (same instance across calls)', () => {
    const { coordinator } = harness();
    expect(coordinator.dragManagerAPI()).toBe(coordinator.dragManagerAPI());
    expect(coordinator.dragManagerAPI()).toBe(coordinator.dragManagerAPI());
  });
});

describe('coordinator — DropTarget registration via primitive API', () => {
  test('registerTarget on the primitive stays live across coord operations', () => {
    const { coordinator } = harness();
    const dm = coordinator.dragManagerAPI();
    const off = dm.registerTarget({
      surfaceId: 'pane:t' as SurfaceId,
      acceptKinds: ['file-path[]'],
      onDrop: () => ({ type: 'dropped', target: 'pane:t' as SurfaceId, action: 'copy' }),
    });
    expect(dm.targetsFor(['file-path[]'])).toHaveLength(1);

    // Coord operations shouldn't clear targets.
    coordinator.upsertSurface({
      id: 'pane:t' as SurfaceId,
      owner: 'dashboard',
      kind: 'pane',
      focusable: true,
      priority: 0,
      render: () => [],
    });
    expect(dm.targetsFor(['file-path[]'])).toHaveLength(1);

    off();
    expect(dm.targetsFor(['file-path[]'])).toHaveLength(0);
  });
});
