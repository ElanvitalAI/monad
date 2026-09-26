// Phase F-3a-2 — coord internals that previously held their own focus
// state for `cycleFocus` + `syncExternalFocus` now read/write through
// the primitive under the default (non-legacy) path. Extracted
// `_ensureRegistered` helper centralises the synthesize-unregistered-
// target guard that both the primitive-direct paths rely on.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { SurfaceId } from '../src/display/types.js';

function harness() {
  const scheduled: Array<() => void> = [];
  const coordinator = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as unknown as NodeJS.Timer; },
  });
  return { coordinator, scheduled };
}

// Q5 (Phase 3, 2026-05-03) — ELANOUS_LEGACY_FOCUS env flag removed.
// Cleanup hooks no longer needed.

describe('F-3a-2 — cycleFocus reads primitive.active (not coord.focus.active)', () => {
  test('cycleFocus after primitive-driven setFocus sees the correct active', () => {
    const { coordinator } = harness();
    const h = coordinator.handle('dashboard');
    h.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    h.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    h.registerFocus({ id: 'c' as SurfaceId, focusable: true, scope: 'dashboard', order: 30 });
    h.focus('a' as SurfaceId);

    // Primitive is now source of truth (F-3a-init). cycleFocus uses
    // primitive.active() to find the current position in the sorted
    // pool and advances by dir.
    const next = coordinator.cycleFocus('dashboard', 1);
    expect(next).toBe('b');
    expect(coordinator.currentFocus()).toBe('b');
  });

  test('cycleFocus wraps around end of sorted pool', () => {
    const { coordinator } = harness();
    const h = coordinator.handle('dashboard');
    h.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    h.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    h.focus('b' as SurfaceId);

    const next = coordinator.cycleFocus('dashboard', 1);
    expect(next).toBe('a');   // wraps to start
  });

  test('cycleFocus with no registered nodes returns null', () => {
    const { coordinator } = harness();
    const next = coordinator.cycleFocus('dashboard', 1);
    expect(next).toBeNull();
  });

  test('cycleFocus respects owner fallback (scope == owner match)', () => {
    // Coord's historical semantic: `scope === scope || owner === scope`
    // — a value like 'dashboard' (also a valid owner) matches both the
    // scope field and the owner field. Primitive's strict scope equality
    // doesn't honour this. F-3a-2 preserves the historical semantic by
    // keeping iteration over coord.focusNodes instead of delegating to
    // primitive.cycle. Verify the behavior survives migration.
    const { coordinator } = harness();
    const h = coordinator.handle('plugin:demo');
    h.registerFocus({
      id: 'widget:1' as SurfaceId,
      focusable: true,
      scope: 'plugin',
      order: 10,
      // owner inferred as 'plugin:demo' from handle scope
    });
    h.registerFocus({
      id: 'widget:2' as SurfaceId,
      focusable: true,
      scope: 'plugin',
      order: 20,
    });

    // Passing an owner string should match by owner, returning the
    // first widget (order asc).
    const next = coordinator.cycleFocus('plugin:demo', 1);
    expect(next).toBe('widget:1');
  });

  // Q5 (Phase 3, 2026-05-03) — `legacy mode — cycleFocus reads
  // coord.focus.active directly` test removed; ELANOUS_LEGACY_FOCUS
  // rollback flag dropped. Primitive is the only source of truth.
});

describe('F-3a-2 — syncExternalFocus primitive-direct delegation', () => {
  test('sync to target routes to primitive.setFocus', () => {
    const { coordinator } = harness();
    const h = coordinator.handle('dashboard');
    h.registerFocus({
      id: 'external:a' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });

    let capturedReason: string | null = null;
    coordinator.focusManagerAPI().on('focused', (ev) => {
      capturedReason = ev.reason;
    });

    coordinator.syncExternalFocus('external:a' as SurfaceId, 'wd-sync');

    expect(coordinator.currentFocus()).toBe('external:a');
    expect(capturedReason).toBe('wd-sync');   // reason flows directly
  });

  test('sync to null routes to primitive.clear', () => {
    const { coordinator } = harness();
    const h = coordinator.handle('dashboard');
    h.registerFocus({
      id: 'external:b' as SurfaceId,
      focusable: true,
      scope: 'dashboard',
      order: 10,
    });
    h.focus('external:b' as SurfaceId);
    expect(coordinator.currentFocus()).toBe('external:b');

    coordinator.syncExternalFocus(null, 'view-exit');

    expect(coordinator.currentFocus()).toBeNull();
    expect(coordinator.focusManagerAPI().active()).toBeNull();
  });

  test('sync to unregistered target still transitions focus (legacy-compat)', () => {
    // Pre-F-3 coord.syncExternalFocus accepted unknown ids. F-3a-2
    // preserves that semantic via the shared `_ensureRegistered`
    // helper which synthesises a minimal focus node.
    const { coordinator } = harness();
    coordinator.syncExternalFocus('synth:id' as SurfaceId, 'fresh');

    expect(coordinator.currentFocus()).toBe('synth:id');
    expect(coordinator.focusManagerAPI().isRegistered('synth:id' as SurfaceId)).toBe(true);
  });

  // Q5 (Phase 3, 2026-05-03) — `legacy mode — syncExternalFocus
  // routes through setFocus/clearFocus wrappers` test removed;
  // ELANOUS_LEGACY_FOCUS rollback flag dropped. The primitive-direct
  // path is the only path.
});

describe('F-3a-2 — `_ensureRegistered` helper consolidation', () => {
  test('setFocus + syncExternalFocus share the synthesis path', () => {
    const { coordinator } = harness();
    // Two unregistered targets; both should get synthesized entries.
    const h = coordinator.handle('dashboard');
    h.focus('synth:via-setFocus' as SurfaceId);
    coordinator.syncExternalFocus('synth:via-sync' as SurfaceId, 'test');

    expect(coordinator.focusManagerAPI().isRegistered('synth:via-setFocus' as SurfaceId)).toBe(true);
    expect(coordinator.focusManagerAPI().isRegistered('synth:via-sync' as SurfaceId)).toBe(true);
  });
});
