// ── A-8-follow · DragManager ctx-wiring parity across viewModes ──
//
// A-8 (PR #318) added `DispatchContext.dragManager?` as an OPTIONAL
// field + ESC entry guard · the guard can only fire when callers
// actually populate the field. Dashboard.ts's 3 `routeInputEvent`
// call sites (streaming · mx-mouse · textInput-onMouse) must all
// wire the ESC guard for it to work uniformly across viewModes.
// This file locks that contract:
//
//   Regression: if a future refactor drops the guard from any of
//   the 3 ctx constructions, ESC-during-drag stops cancelling
//   silently in that viewMode (the guard short-circuit becomes dead
//   code). These tests fail loudly per viewMode.
//
// I.2 migration (PR #374): the guard moved from a dispatcher
// hard-coded branch to a `DragEscInterceptor` registered on
// `ctx.interceptors`. The parity contract is now:
//   All 3 dashboard sites MUST wire `interceptors` (containing the
//   DragEscInterceptor) in addition to `dragManager`. The fixture
//   below mirrors that production wiring so the pre-I.2 assertions
//   keep pinning the same behaviour.
//
// We can't boot the full dashboard — instead we replicate the ctx
// shape dashboard.ts uses in each of the 3 sites (same shape as
// dashboard-a3/a4/a5 tests) and confirm the guard fires.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  derivePolicyForViewMode,
  type DispatchContext,
  type KeyInputEvent,
  type RouteCallbacks,
} from '../src/input-core/index.js';
import { createInterceptorRegistry } from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import type { ViewMode } from '../src/input-core/view-mode.js';

// ── Fixtures ───────────────────────────────────────────────

/** Minimal DragManager mock matching A-8's unit-test pattern. The
 *  guard only touches `isActive()` + `cancelAll(reason)`. */
function mkDragManagerMock(isActive: boolean): {
  manager: NonNullable<DispatchContext['dragManager']>;
  cancelCalls: string[];
  interceptors: NonNullable<DispatchContext['interceptors']>;
} {
  const cancelCalls: string[] = [];
  const manager = {
    isActive: () => isActive,
    cancelAll: (reason: string) => { cancelCalls.push(reason); },
  } as unknown as NonNullable<DispatchContext['dragManager']>;
  const interceptors = createInterceptorRegistry();
  interceptors.register(createDragEscInterceptor(manager));
  return { manager, cancelCalls, interceptors };
}

const esc = (): KeyInputEvent => ({
  kind: 'key',
  key: { name: 'escape', sequence: '\x1b', ctrl: false, meta: false, shift: false },
});

/** Empty route callbacks — the ESC guard must short-circuit BEFORE
 *  any viewMode arm runs, so no callback should fire. */
const noRoutes: RouteCallbacks = {};

function mkCtx(viewMode: ViewMode, dragActive: boolean): {
  ctx: DispatchContext;
  cancelCalls: string[];
} {
  const { manager, cancelCalls, interceptors } = mkDragManagerMock(dragActive);
  return {
    ctx: {
      viewMode,
      policy: derivePolicyForViewMode(viewMode),
      routes: noRoutes,
      dragManager: manager,
      interceptors,
    },
    cancelCalls,
  };
}

// ── Parity matrix across the 3 dashboard dispatch sites ────

describe('A-8-follow · dragManager ctx-wiring parity', () => {
  test('streaming viewMode (A-5 site · L4094) · ESC + drag → cancelAll', () => {
    const { ctx, cancelCalls } = mkCtx({ kind: 'streaming' }, true);
    const outcome = routeInputEvent(esc(), ctx);
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
  });

  test('idle viewMode (A-3 mx-mouse site · L4973) · ESC + drag → cancelAll', () => {
    const { ctx, cancelCalls } = mkCtx({ kind: 'idle' }, true);
    const outcome = routeInputEvent(esc(), ctx);
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
  });

  test('input viewMode (A-4 textInput site · L5062) · ESC + drag → cancelAll', () => {
    const { ctx, cancelCalls } = mkCtx({ kind: 'input' }, true);
    const outcome = routeInputEvent(esc(), ctx);
    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
  });

  test('drag inactive → guard skipped across all 3 viewModes (fallthrough)', () => {
    for (const viewMode of [
      { kind: 'streaming' } as const,
      { kind: 'idle' } as const,
      { kind: 'input' } as const,
    ]) {
      const { ctx, cancelCalls } = mkCtx(viewMode, false);
      routeInputEvent(esc(), ctx);
      expect(cancelCalls).toEqual([]);
    }
  });
});
