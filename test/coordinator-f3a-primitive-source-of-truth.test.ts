// Phase F-3a — coordinator's internal setFocus / clearFocus paths
// delegate to the FocusManager primitive · primitive is source of
// truth for focus writes · coord.focus updated via inverse-mirror
// listener. Legacy behavior preserved under env flag
// `MONAD_LEGACY_FOCUS=1`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/types.js';

function harness() {
  const scheduled: Array<() => void> = [];
  const focusChanges: Array<{ prev: SurfaceId | null; next: SurfaceId; reason?: string }> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
    hooks: {
      onFocusChanged: (prev, next, reason) => focusChanges.push({ prev, next, reason }),
    },
  });
  return { coordinator, scheduled, focusChanges };
}

// Q5 (Phase 3, 2026-05-03) — MONAD_LEGACY_FOCUS env flag removed.
// Cleanup hooks no longer needed.

describe('F-3a — default mode · primitive is source of truth', () => {
  test('setFocus via publish propagates to primitive active() and coord currentFocus()', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'node:a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.focus('node:a' as SurfaceId);

    expect(coordinator.currentFocus()).toBe('node:a');
    expect(coordinator.focusManagerAPI().active()?.id).toBe('node:a');
  });

  test('focus transition invokes hooks.onFocusChanged via inverse mirror', () => {
    const { coordinator, focusChanges } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'node:a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'node:b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    handle.focus('node:a' as SurfaceId);
    handle.focus('node:b' as SurfaceId);

    expect(focusChanges).toHaveLength(2);
    expect(focusChanges[0]).toEqual({ prev: null, next: 'node:a', reason: 'setFocus' });
    expect(focusChanges[1]).toEqual({ prev: 'node:a', next: 'node:b', reason: 'setFocus' });
  });

  test('idempotent setFocus — same target twice fires only one transition', () => {
    const { coordinator, focusChanges } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'node:a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.focus('node:a' as SurfaceId);
    handle.focus('node:a' as SurfaceId);
    handle.focus('node:a' as SurfaceId);

    expect(focusChanges).toHaveLength(1);
    expect(coordinator.currentFocus()).toBe('node:a');
  });

  test('setFocus on unregistered target synthesizes focus node (legacy-compat)', () => {
    // Pre-F-3a, coord.setFocus accepted unknown targets. F-3a keeps
    // this behavior by auto-registering a minimal focus node so
    // callers that reached setFocus without explicit registration
    // (e.g. mountSurface variants that set focus) still work.
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');

    handle.focus('synthetic:id' as SurfaceId);

    expect(coordinator.currentFocus()).toBe('synthetic:id');
    expect(coordinator.focusManagerAPI().isRegistered('synthetic:id' as SurfaceId)).toBe(true);
  });

  test('setFocus on non-focusable node is a no-op', () => {
    const { coordinator, focusChanges } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'node:pf' as SurfaceId, focusable: false, scope: 'dashboard', order: 10 });
    handle.focus('node:pf' as SurfaceId);

    expect(coordinator.currentFocus()).toBeNull();
    expect(focusChanges).toHaveLength(0);
  });

  test('coord.focus.stack reflects primitive history via inverse mirror', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'node:a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'node:b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    handle.focus('node:a' as SurfaceId);
    handle.focus('node:b' as SurfaceId);

    const snap = coordinator.snapshot();
    expect(snap.focus.active).toBe('node:b');
    expect(snap.focus.previous).toBe('node:a');
    expect(snap.focus.stack).toContain('node:a');
    expect(snap.focus.stack).toContain('node:b');
  });

  test('clearFocus delegation via primitive.clear propagates coord state', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');

    const reg = handle.registerFocus({
      id: 'node:clr' as SurfaceId, focusable: true, scope: 'dashboard', order: 10,
    });
    handle.focus('node:clr' as SurfaceId);
    expect(coordinator.currentFocus()).toBe('node:clr');

    // dispose triggers internal clearFocus when no next is focusable.
    reg.dispose();
    expect(coordinator.currentFocus()).toBeNull();
    expect(coordinator.focusManagerAPI().active()).toBeNull();
  });
});

describe('F-3a — cycleFocus uses primitive write path', () => {
  test('cycleFocus changes active via primitive · primitive.active matches', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    handle.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    handle.registerFocus({ id: 'c' as SurfaceId, focusable: true, scope: 'dashboard', order: 30 });
    handle.focus('a' as SurfaceId);

    const n = coordinator.cycleFocus('dashboard', 1);
    expect(n).toBe('b');
    expect(coordinator.currentFocus()).toBe('b');
    expect(coordinator.focusManagerAPI().active()?.id).toBe('b');
  });
});

// Q5 (Phase 3, 2026-05-03) — Legacy-mode describe blocks removed.
// MONAD_LEGACY_FOCUS env flag dropped; primitive is the only path.
// Pre-removal coverage:
//   • `legacy mode (MONAD_LEGACY_FOCUS=1) · writes go via old path`
//     — 3 tests asserting parity between legacy and default modes.
//   • `env flag toggled per-call` — 1 test asserting mid-session
//     mode switching preserved state.
// All gated correctness lives in the default-mode `F-3a` describe
// blocks above, which now exercise the only supported behavior.
