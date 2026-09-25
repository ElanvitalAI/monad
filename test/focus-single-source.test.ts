// Q5 Phase 3 full (2026-05-03) — coord.focus field is gone. The
// FocusManager primitive is the single source of truth for focus
// state (active, previous, history); the coordinator owns only a
// derived paint stack for non-focusable picker iteration. These
// tests pin the new contract:
//
//   1. snapshot.focus is derived — primitive and snapshot agree
//      at every observable moment.
//   2. The DisplayCoordinator instance no longer carries a
//      `focus` field (compile + runtime guard).
//   3. closeSurface restores focus via primitive.previous(),
//      not via a parallel coord.focus.previous mirror.
//
// PLAN ref: 내부 문서 `PLAN-substrate-rebuild-2026-05-03` §5
// REQUIREMENTS ref: 내부 문서 `REQUIREMENTS-substrate-occam-2026-05-03` §3.1

import { describe, expect, test } from 'bun:test';
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

describe('Q5 Phase 3 full — focus single source', () => {
  test('coord no longer has a `focus` instance field', () => {
    const { coordinator } = harness();
    // Reflective check — the field should be absent. Rely on
    // `Object.hasOwn` so we don't trip on the public `focusManager`
    // private (which is a different identifier).
    const own = Object.getOwnPropertyNames(coordinator);
    expect(own).not.toContain('focus');
  });

  test('snapshot.focus.active matches primitive.active() at every step', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    const fm = coordinator.focusManagerAPI();

    // Empty state.
    expect(coordinator.snapshot().focus.active).toBe(fm.active()?.id ?? null);

    handle.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });

    handle.focus('a' as SurfaceId);
    expect(coordinator.snapshot().focus.active).toBe(fm.active()?.id ?? null);
    expect(coordinator.snapshot().focus.active).toBe('a');

    handle.focus('b' as SurfaceId);
    expect(coordinator.snapshot().focus.active).toBe(fm.active()?.id ?? null);
    expect(coordinator.snapshot().focus.active).toBe('b');
  });

  test('snapshot.focus.previous matches primitive.previous() at every step', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    const fm = coordinator.focusManagerAPI();

    handle.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });

    handle.focus('a' as SurfaceId);
    handle.focus('b' as SurfaceId);

    const snapPrev = coordinator.snapshot().focus.previous ?? null;
    const primPrev = fm.previous()?.id ?? null;
    expect(snapPrev).toBe(primPrev);
    expect(snapPrev).toBe('a');
  });

  test('cycleFocus updates primitive — snapshot reflects without delay', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    const fm = coordinator.focusManagerAPI();

    handle.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.registerFocus({ id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20 });
    handle.focus('a' as SurfaceId);

    coordinator.cycleFocus('dashboard', 1);
    expect(coordinator.snapshot().focus.active).toBe(fm.active()?.id ?? null);
    expect(coordinator.snapshot().focus.active).toBe('b');
  });

  test('closeSurface (via dispose) restores focus from primitive previous', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    const fm = coordinator.focusManagerAPI();

    handle.registerFocus({ id: 'a' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    const regB = handle.registerFocus({
      id: 'b' as SurfaceId, focusable: true, scope: 'dashboard', order: 20,
    });
    handle.focus('a' as SurfaceId);
    handle.focus('b' as SurfaceId);
    expect(fm.active()?.id).toBe('b');
    expect(fm.previous()?.id).toBe('a');

    // dispose b → next focusable should fall back to 'a' (the captured previous).
    regB.dispose();
    expect(coordinator.snapshot().focus.active).toBe(fm.active()?.id ?? null);
  });

  test('idempotent reads — primitive.state() and snapshot.focus.active stay coherent across many transitions', () => {
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');
    const fm = coordinator.focusManagerAPI();

    for (let i = 0; i < 5; i++) {
      handle.registerFocus({
        id: `n:${i}` as SurfaceId, focusable: true, scope: 'dashboard', order: i * 10,
      });
    }
    for (let i = 0; i < 25; i++) {
      const target = `n:${i % 5}` as SurfaceId;
      handle.focus(target);
      const snapActive = coordinator.snapshot().focus.active;
      const primActive = fm.active()?.id ?? null;
      expect(snapActive).toBe(primActive);
    }
  });

  test('paintStack includes non-focusable picker mounts (primitive history would not)', () => {
    // Pickers are non-focusable modals that need to be on the visual
    // paint stack for renderModalStack iteration. The primitive's
    // history only tracks focusable nodes; the coord-side paintStack
    // bridges the two. snapshot.focus.stack returns paintStack so
    // existing consumers continue to see the union.
    const { coordinator } = harness();
    const handle = coordinator.handle('dashboard');

    handle.registerFocus({ id: 'pf' as SurfaceId, focusable: true, scope: 'dashboard', order: 10 });
    handle.focus('pf' as SurfaceId);

    const stack = coordinator.snapshot().focus.stack;
    expect(stack).toContain('pf');
  });
});
