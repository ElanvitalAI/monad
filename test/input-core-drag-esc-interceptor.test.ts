// I.2.2 · DragEscInterceptor unit + dispatcher integration tests.
//
// Split into two describe blocks as called out in
// 내부 문서 `PLAN-compositor-i2-interceptor-registry` §6:
//   - Unit · `createDragEscInterceptor` (4 cases)
//   - Integration · dispatcher via registry (8 cases)
//
// Backward-compat regression for the A-8 branch retiring lives in
// test/input-core-dispatcher.test.ts + test/input-core-dispatcher-async.test.ts —
// the fixtures there were updated to register this interceptor so the
// pre-I.2 behaviour is still pinned by the same assertions.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  routeInputEventAsync,
  derivePolicyForViewMode,
  type DispatchContext,
  type DispatchOutcome,
  type RouteCallbacks,
} from '../src/input-core/dispatcher.js';
import {
  createInterceptorRegistry,
  type KeyInterceptor,
} from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import { keyEvent, type InputEvent, type KeyInputEvent, type MouseInputEvent } from '../src/input-core/event.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { DragManager } from '../src/primitives/drag-session/index.js';

// ── Fixture helpers ────────────────────────────────────────────────

const VM_IDLE: ViewMode = { kind: 'idle' };
const VM_MODAL: ViewMode = { kind: 'modal', modalId: 'mod-1' };

const k = (name: string): KeyInputEvent => keyEvent({ name, ctrl: false, shift: false });

const mouse = (overrides: Partial<MouseInputEvent> = {}): MouseInputEvent => ({
  kind: 'mouse',
  type: 'click',
  row: 0,
  col: 0,
  target: { kind: 'unknown' },
  ...overrides,
});

/** Minimal DragManager stub. Only the two methods DragEscInterceptor
 *  uses (`isActive` + `cancelAll`) have observable state; the rest
 *  throw so a regression pulling them in loudly fails the test. */
function stubDragManager(opts: { active: boolean }): {
  dm: DragManager;
  calls: string[];
} {
  const calls: string[] = [];
  let active = opts.active;
  const dm = {
    begin: () => {
      throw new Error('stubDragManager.begin called');
    },
    registerTarget: () => () => {},
    targetsFor: () => [],
    current: () => null,
    isActive: () => active,
    on: () => () => {},
    handleMouse: () => false,
    cancelAll: (reason: string) => {
      calls.push(reason);
      active = false;
    },
  } satisfies DragManager;
  return { dm, calls };
}

// ── Unit · createDragEscInterceptor ────────────────────────────────

describe('createDragEscInterceptor · unit', () => {
  test('drag active + ESC → consumed + cancelAll("escape")', () => {
    const { dm, calls } = stubDragManager({ active: true });
    const ic = createDragEscInterceptor(dm);
    const ctx: DispatchContext = {
      viewMode: VM_IDLE,
      policy: derivePolicyForViewMode(VM_IDLE),
      routes: {},
    };
    expect(ic.intercept(k('escape'), ctx)).toBe('consumed');
    expect(calls).toEqual(['escape']);
  });

  test('drag inactive + ESC → passthrough, no cancel', () => {
    const { dm, calls } = stubDragManager({ active: false });
    const ic = createDragEscInterceptor(dm);
    const ctx: DispatchContext = {
      viewMode: VM_IDLE,
      policy: derivePolicyForViewMode(VM_IDLE),
      routes: {},
    };
    expect(ic.intercept(k('escape'), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
  });

  test('non-ESC key + drag active → passthrough, no cancel', () => {
    const { dm, calls } = stubDragManager({ active: true });
    const ic = createDragEscInterceptor(dm);
    const ctx: DispatchContext = {
      viewMode: VM_IDLE,
      policy: derivePolicyForViewMode(VM_IDLE),
      routes: {},
    };
    expect(ic.intercept(k('a'), ctx)).toBe('passthrough');
    expect(ic.intercept(k('enter'), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
  });

  test('mouse event + drag active → passthrough (type discriminator)', () => {
    const { dm, calls } = stubDragManager({ active: true });
    const ic = createDragEscInterceptor(dm);
    const ctx: DispatchContext = {
      viewMode: VM_IDLE,
      policy: derivePolicyForViewMode(VM_IDLE),
      routes: {},
    };
    expect(ic.intercept(mouse(), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
  });

  test('interceptor has the documented name and priority', () => {
    const { dm } = stubDragManager({ active: false });
    const ic = createDragEscInterceptor(dm);
    expect(ic.name).toBe('drag-esc-cancel');
    expect(ic.priority).toBe(100);
  });
});

// ── Integration · dispatcher via registry ──────────────────────────

function trackingRoutes(log: string[]): RouteCallbacks {
  const make = (name: string): (ev: InputEvent) => DispatchOutcome =>
    ((_ev: InputEvent) => {
      log.push(name);
      return 'passthrough';
    });
  return {
    routeToModal: make('routeToModal'),
    routeFocusedWidgetKey: make('routeFocusedWidgetKey') as (ev: KeyInputEvent) => DispatchOutcome,
    routeGlobalBindings: make('routeGlobalBindings'),
  };
}

function mkCtxWith(
  viewMode: ViewMode,
  dm: DragManager,
  routes: RouteCallbacks,
): DispatchContext {
  const interceptors = createInterceptorRegistry();
  interceptors.register(createDragEscInterceptor(dm));
  return {
    viewMode,
    policy: derivePolicyForViewMode(viewMode),
    routes,
    dragManager: dm,
    interceptors,
  };
}

describe('dispatcher · DragEscInterceptor integration (sync)', () => {
  test('drag active + ESC → consumed · viewMode arms NOT called', () => {
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const ctx = mkCtxWith(VM_MODAL, dm, trackingRoutes(log));
    expect(routeInputEvent(k('escape'), ctx)).toBe('consumed');
    expect(calls).toEqual(['escape']);
    expect(log).toEqual([]);
  });

  test('drag inactive + ESC → viewMode arm reached (modal branch)', () => {
    const { dm, calls } = stubDragManager({ active: false });
    const log: string[] = [];
    const ctx = mkCtxWith(VM_MODAL, dm, trackingRoutes(log));
    expect(routeInputEvent(k('escape'), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
    expect(log).toEqual(['routeToModal']);
  });

  test('drag active + non-ESC → viewMode arm reached · cancelAll not invoked', () => {
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const ctx = mkCtxWith(VM_MODAL, dm, trackingRoutes(log));
    expect(routeInputEvent(k('a'), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
    expect(log).toEqual(['routeToModal']);
  });

  test('ctx.interceptors undefined → legacy passthrough (no A-8 hard-coded branch)', () => {
    // After I.2 migration the dispatcher no longer self-handles the
    // A-8 branch. Callers that never wire `interceptors` see a plain
    // viewMode arm dispatch — this is the exact pre-I.2 fallback path
    // every old fixture relies on.
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const ctx: DispatchContext = {
      viewMode: VM_MODAL,
      policy: derivePolicyForViewMode(VM_MODAL),
      routes: trackingRoutes(log),
      dragManager: dm,
      // interceptors omitted on purpose
    };
    // ESC no longer consumed by the dispatcher itself · it reaches
    // the modal arm. Drag is NOT cancelled because no interceptor
    // was registered.
    expect(routeInputEvent(k('escape'), ctx)).toBe('passthrough');
    expect(calls).toEqual([]);
    expect(log).toEqual(['routeToModal']);
  });
});

describe('dispatcher · DragEscInterceptor integration (async)', () => {
  test('drag active + ESC → consumed via async entry', async () => {
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const ctx = mkCtxWith(VM_MODAL, dm, trackingRoutes(log));
    await expect(routeInputEventAsync(k('escape'), ctx)).resolves.toBe('consumed');
    expect(calls).toEqual(['escape']);
    expect(log).toEqual([]);
  });

  test('drag inactive + ESC via async → viewMode arm reached', async () => {
    const { dm, calls } = stubDragManager({ active: false });
    const log: string[] = [];
    const ctx = mkCtxWith(VM_MODAL, dm, trackingRoutes(log));
    await expect(routeInputEventAsync(k('escape'), ctx)).resolves.toBe('passthrough');
    expect(calls).toEqual([]);
    expect(log).toEqual(['routeToModal']);
  });

  test('ctx.interceptors undefined → legacy passthrough via async', async () => {
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const ctx: DispatchContext = {
      viewMode: VM_MODAL,
      policy: derivePolicyForViewMode(VM_MODAL),
      routes: trackingRoutes(log),
      dragManager: dm,
    };
    await expect(routeInputEventAsync(k('escape'), ctx)).resolves.toBe('passthrough');
    expect(calls).toEqual([]);
    expect(log).toEqual(['routeToModal']);
  });
});

// ── Integration · chain composition ────────────────────────────────

describe('dispatcher · interceptor chain composition', () => {
  test('higher-priority custom interceptor pre-empts DragEsc', () => {
    // A future global interceptor that sits at priority > 100 would
    // run before DragEsc. The registry contract guarantees that. This
    // test pins the contract so a refactor that reorders sort() is
    // caught at the unit layer.
    const { dm, calls } = stubDragManager({ active: true });
    const log: string[] = [];
    const routes = trackingRoutes(log);
    const interceptors = createInterceptorRegistry();
    const preempt: KeyInterceptor = {
      name: 'preempt',
      priority: 200,
      intercept(ev) {
        return ev.kind === 'key' && ev.key.name === 'escape' ? 'consumed' : 'passthrough';
      },
    };
    interceptors.register(preempt);
    interceptors.register(createDragEscInterceptor(dm));
    const ctx: DispatchContext = {
      viewMode: VM_MODAL,
      policy: derivePolicyForViewMode(VM_MODAL),
      routes,
      dragManager: dm,
      interceptors,
    };
    expect(routeInputEvent(k('escape'), ctx)).toBe('consumed');
    // DragEsc never ran · drag still active.
    expect(calls).toEqual([]);
    expect(log).toEqual([]);
  });
});
