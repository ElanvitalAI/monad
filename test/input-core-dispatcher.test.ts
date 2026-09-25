import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  derivePolicyForViewMode,
  type DispatchContext,
  type DispatchOutcome,
  type RouteCallbacks,
} from '../src/input-core/dispatcher.js';
import { createInterceptorRegistry } from '../src/input-core/interceptor.js';
import { createDragEscInterceptor } from '../src/input-core/drag-esc-interceptor.js';
import { keyEvent, type InputEvent, type KeyInputEvent, type MouseInputEvent } from '../src/input-core/event.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { Key } from '../src/tui.js';

// ── Fixture helpers ──

const k = (name: string, mods: Partial<Key> = {}): KeyInputEvent =>
  keyEvent({ name, ctrl: false, shift: false, ...mods });

const mouse = (overrides: Partial<MouseInputEvent> = {}): MouseInputEvent => ({
  kind: 'mouse',
  type: 'click',
  row: 10,
  col: 10,
  target: { kind: 'unknown' },
  ...overrides,
});

type Log = Array<{ name: string; ev: InputEvent; allow?: boolean }>;

function trackingRoutes(
  log: Log,
  overrides: Partial<Record<keyof RouteCallbacks, DispatchOutcome>> = {},
): RouteCallbacks {
  const make = (name: keyof RouteCallbacks, default_: DispatchOutcome = 'passthrough') => {
    const outcome = overrides[name] ?? default_;
    return (ev: InputEvent, allow?: boolean) => {
      log.push({ name, ev, ...(allow !== undefined ? { allow } : {}) });
      return outcome;
    };
  };
  return {
    routeToTerminalModal:   make('routeToTerminalModal'),
    routeToModal:           make('routeToModal'),
    routeToPlugin:          make('routeToPlugin'),
    routeChord:             make('routeChord'),
    routeStreamingKey:      make('routeStreamingKey') as (ev: KeyInputEvent) => DispatchOutcome,
    routeMouseWiring:       make('routeMouseWiring') as (ev: MouseInputEvent) => DispatchOutcome,
    routePaneNavClick:      make('routePaneNavClick') as (ev: MouseInputEvent) => DispatchOutcome,
    routePaneClick:         make('routePaneClick') as (ev: MouseInputEvent, a: boolean) => DispatchOutcome,
    routeLogZoneClick:      make('routeLogZoneClick') as (ev: MouseInputEvent, a: boolean) => DispatchOutcome,
    routeFocusedWidgetKey:  make('routeFocusedWidgetKey') as (ev: KeyInputEvent) => DispatchOutcome,
    routeGlobalBindings:    make('routeGlobalBindings'),
  };
}

function mkCtx(
  viewMode: ViewMode,
  routes: RouteCallbacks,
  policy?: DispatchContext['policy'],
): DispatchContext {
  return {
    viewMode,
    policy: policy ?? derivePolicyForViewMode(viewMode),
    routes,
  };
}

const VM_IDLE:     ViewMode = { kind: 'idle' };
const VM_INPUT:    ViewMode = { kind: 'input' };
const VM_STREAM:   ViewMode = { kind: 'streaming' };
const VM_MODAL:    ViewMode = { kind: 'modal', modalId: 'mod-1' };
const VM_TERM:     ViewMode = { kind: 'terminal-modal', terminalId: 't-1' };
const VM_PLUGIN:   ViewMode = { kind: 'plugin', pluginId: 'p-1' };
const VM_CHORD:    ViewMode = { kind: 'chord-armed', leader: 'ctrl+b' };

// ── derivePolicyForViewMode ──

describe('derivePolicyForViewMode', () => {
  test('input mode blocks focus-steal', () => {
    expect(derivePolicyForViewMode(VM_INPUT)).toEqual({ allowFocusSteal: false });
  });

  test('idle mode allows focus-steal', () => {
    expect(derivePolicyForViewMode(VM_IDLE)).toEqual({ allowFocusSteal: true });
  });

  test('streaming mode allows focus-steal', () => {
    expect(derivePolicyForViewMode(VM_STREAM)).toEqual({ allowFocusSteal: true });
  });

  test('modal / terminal / plugin / chord all allow focus-steal', () => {
    expect(derivePolicyForViewMode(VM_MODAL).allowFocusSteal).toBe(true);
    expect(derivePolicyForViewMode(VM_TERM).allowFocusSteal).toBe(true);
    expect(derivePolicyForViewMode(VM_PLUGIN).allowFocusSteal).toBe(true);
    expect(derivePolicyForViewMode(VM_CHORD).allowFocusSteal).toBe(true);
  });
});

// ── High-priority arms ──

describe('routeInputEvent — high-priority arms', () => {
  test('terminal-modal arm invokes routeToTerminalModal only', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeToTerminalModal: 'consumed' });
    const outcome = routeInputEvent(k('escape'), mkCtx(VM_TERM, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeToTerminalModal']);
  });

  test('modal arm invokes routeToModal only', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeToModal: 'consumed' });
    const outcome = routeInputEvent(k('enter'), mkCtx(VM_MODAL, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeToModal']);
  });

  test('plugin arm invokes routeToPlugin only', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeToPlugin: 'consumed' });
    const outcome = routeInputEvent(k('a'), mkCtx(VM_PLUGIN, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeToPlugin']);
  });

  test('chord-armed arm invokes routeChord only', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeChord: 'consumed' });
    const outcome = routeInputEvent(k('c'), mkCtx(VM_CHORD, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeChord']);
  });

  test('high-priority arm passthrough does NOT fall through to other arms', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    // modal route returns passthrough (default) — event should NOT
    // reach focused-widget or global bindings.
    const outcome = routeInputEvent(k('a'), mkCtx(VM_MODAL, routes));
    expect(outcome).toBe('passthrough');
    expect(log.map((e) => e.name)).toEqual(['routeToModal']);
  });

  test('unwired high-priority arm returns passthrough without invoking anything else', () => {
    const log: Log = [];
    const outcome = routeInputEvent(k('a'), mkCtx(VM_MODAL, { /* no routes */ }));
    expect(outcome).toBe('passthrough');
    expect(log).toEqual([]);
  });
});

// ── Streaming arm (mixed key/mouse) ──

describe('routeInputEvent — streaming arm', () => {
  test('streaming key uses routeStreamingKey first', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeStreamingKey: 'consumed' });
    const outcome = routeInputEvent(k('j'), mkCtx(VM_STREAM, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeStreamingKey']);
  });

  test('streaming routes a press once and ignores its release', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeStreamingKey: 'consumed' });
    const press = routeInputEvent(k('j'), mkCtx(VM_STREAM, routes));
    const release = routeInputEvent(k('j', { kind: 'release' }), mkCtx(VM_STREAM, routes));
    expect(press).toBe('consumed');
    expect(release).toBe('passthrough');
    expect(log.map((e) => e.name)).toEqual(['routeStreamingKey']);
  });

  test('streaming key falls back to focused-widget + global when streaming passthrough', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeGlobalBindings: 'consumed' });
    const outcome = routeInputEvent(k('j'), mkCtx(VM_STREAM, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual([
      'routeStreamingKey',
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('streaming mouse falls through to idle-style mouse fallback chain', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routePaneClick: 'consumed' });
    const outcome = routeInputEvent(mouse(), mkCtx(VM_STREAM, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
    ]);
  });

  test('streaming mouse does NOT invoke routeStreamingKey', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    routeInputEvent(mouse(), mkCtx(VM_STREAM, routes));
    expect(log.map((e) => e.name)).not.toContain('routeStreamingKey');
  });
});

// ── Idle / input arms ──

describe('routeInputEvent — idle / input mouse fallback chain', () => {
  test('idle: wiring → pane-nav → pane-click → log-zone walk order', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    routeInputEvent(mouse(), mkCtx(VM_IDLE, routes));
    expect(log.map((e) => e.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
      'routeLogZoneClick',
    ]);
  });

  test('idle: wiring consumes → short-circuits', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeMouseWiring: 'consumed' });
    const outcome = routeInputEvent(mouse(), mkCtx(VM_IDLE, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeMouseWiring']);
  });

  test('idle: pane-click consumed → log-zone NOT invoked', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routePaneClick: 'consumed' });
    const outcome = routeInputEvent(mouse(), mkCtx(VM_IDLE, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
    ]);
  });

  test('input: pane-click receives allowFocusSteal=false', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routePaneClick: 'consumed' });
    routeInputEvent(mouse(), mkCtx(VM_INPUT, routes));
    const paneClickCall = log.find((e) => e.name === 'routePaneClick');
    expect(paneClickCall?.allow).toBe(false);
  });

  test('idle: pane-click receives allowFocusSteal=true', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routePaneClick: 'consumed' });
    routeInputEvent(mouse(), mkCtx(VM_IDLE, routes));
    const paneClickCall = log.find((e) => e.name === 'routePaneClick');
    expect(paneClickCall?.allow).toBe(true);
  });

  test('input: log-zone also receives allowFocusSteal=false', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeLogZoneClick: 'consumed' });
    routeInputEvent(mouse(), mkCtx(VM_INPUT, routes));
    const logCall = log.find((e) => e.name === 'routeLogZoneClick');
    expect(logCall?.allow).toBe(false);
  });

  test('idle mouse with no routes wired → passthrough', () => {
    const outcome = routeInputEvent(mouse(), mkCtx(VM_IDLE, {}));
    expect(outcome).toBe('passthrough');
  });
});

describe('routeInputEvent — idle / input key fallback chain', () => {
  test('focused-widget consumes → global bindings NOT invoked', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeFocusedWidgetKey: 'consumed' });
    const outcome = routeInputEvent(k('a'), mkCtx(VM_IDLE, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual(['routeFocusedWidgetKey']);
  });

  test('focused-widget passthrough → global bindings invoked', () => {
    const log: Log = [];
    const routes = trackingRoutes(log, { routeGlobalBindings: 'consumed' });
    const outcome = routeInputEvent(k('a'), mkCtx(VM_IDLE, routes));
    expect(outcome).toBe('consumed');
    expect(log.map((e) => e.name)).toEqual([
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('input mode key dispatch goes through same fallback as idle', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    routeInputEvent(k('x'), mkCtx(VM_INPUT, routes));
    expect(log.map((e) => e.name)).toEqual([
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('input mode key passthrough with no routes → passthrough', () => {
    const outcome = routeInputEvent(k('x'), mkCtx(VM_INPUT, {}));
    expect(outcome).toBe('passthrough');
  });
});

// ── Priority ordering ──

describe('routeInputEvent — arm priority', () => {
  test('terminal-modal wins over modal when both viewmodes were possible (tested via viewMode kind)', () => {
    // viewMode is produced by deriveViewMode; here we just confirm
    // dispatcher honours the passed-in viewMode.kind.
    const log: Log = [];
    const routes = trackingRoutes(log, {
      routeToTerminalModal: 'consumed',
      routeToModal: 'consumed',
    });
    routeInputEvent(k('a'), mkCtx(VM_TERM, routes));
    expect(log.map((e) => e.name)).toEqual(['routeToTerminalModal']);
  });

  test('chord-armed does NOT fall through to idle key fallback', () => {
    // Chord passthrough must NOT reach focused-widget / global — the
    // chord body would be mis-dispatched otherwise.
    const log: Log = [];
    const routes = trackingRoutes(log);
    const outcome = routeInputEvent(k('c'), mkCtx(VM_CHORD, routes));
    expect(outcome).toBe('passthrough');
    expect(log.map((e) => e.name)).toEqual(['routeChord']);
  });
});

// ── Custom policy override ──

describe('routeInputEvent — custom policy override', () => {
  test('explicit policy overrides derivePolicyForViewMode default', () => {
    // Idle mode defaults to allowFocusSteal=true, but caller can force
    // false (e.g. temporary modal semantics in a consumer).
    const log: Log = [];
    const routes = trackingRoutes(log, { routePaneClick: 'consumed' });
    const ctx: DispatchContext = {
      viewMode: VM_IDLE,
      policy: { allowFocusSteal: false },
      routes,
    };
    routeInputEvent(mouse(), ctx);
    const paneClickCall = log.find((e) => e.name === 'routePaneClick');
    expect(paneClickCall?.allow).toBe(false);
  });
});

// ── A-8 · DragSession ESC entry guard ─────────────────────

/** Minimal DragManager mock · only the two methods A-8 cares about.
 *  The full DragManager interface (begin / registerTarget /
 *  handleMouse / current / on / cancelAll) has many more methods, but
 *  the A-8 guard (now a `DragEscInterceptor` · PR #374) only touches
 *  `isActive()` + `cancelAll(reason)`. A cast lets us fake just those
 *  two.
 *
 *  Since I.2 migrated the A-8 guard from a dispatcher hard-coded
 *  branch to an interceptor policy, this helper also returns a ready
 *  `InterceptorRegistry` with `DragEscInterceptor` pre-registered.
 *  Callers spread `dragManager: manager, interceptors` into their
 *  `DispatchContext` and the A-8 behaviour is pinned by the same
 *  assertions as before the migration. */
function mkDragManagerMock(isActiveValue: boolean): {
  manager: NonNullable<DispatchContext['dragManager']>;
  cancelCalls: string[];
  interceptors: NonNullable<DispatchContext['interceptors']>;
} {
  const cancelCalls: string[] = [];
  const manager = {
    isActive: () => isActiveValue,
    cancelAll: (reason: string) => { cancelCalls.push(reason); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as NonNullable<DispatchContext['dragManager']>;
  const interceptors = createInterceptorRegistry();
  interceptors.register(createDragEscInterceptor(manager));
  return { manager, cancelCalls, interceptors };
}

describe('A-8 · drag-active ESC entry guard', () => {
  test('ESC key + drag active → consumed + cancelAll(\'escape\')', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, routes),
      dragManager: manager,
      interceptors,
    };
    const outcome = routeInputEvent(k('escape'), ctx);

    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
    // Dispatcher short-circuits · no viewMode arm fires.
    expect(log).toEqual([]);
  });

  test('ESC key + drag inactive → falls through to viewMode arms', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(false);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, routes),
      dragManager: manager,
      interceptors,
    };
    routeInputEvent(k('escape'), ctx);

    // No cancel call · event flows through key fallback chain.
    expect(cancelCalls).toEqual([]);
    expect(log.map((e) => e.name)).toEqual([
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('non-ESC key + drag active → falls through (chord leader etc. still work during drag)', () => {
    const log: Log = [];
    const routes = trackingRoutes(log);
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, routes),
      dragManager: manager,
      interceptors,
    };
    routeInputEvent(k('a'), ctx);

    // Drag active but key isn't ESC · no cancel · normal key dispatch.
    expect(cancelCalls).toEqual([]);
    expect(log.map((e) => e.name)).toEqual([
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('mouse event + drag active → NOT cancelled (mouse intercept is drag-dispatch adapter\'s job)', () => {
    // A-8's scope is ESC-only. Mouse under drag-active goes through
    // the normal viewMode arms (in production, the drag-dispatch
    // adapter intercepts BEFORE routeInputEvent so this path only
    // runs when the adapter explicitly let the event through).
    const log: Log = [];
    const routes = trackingRoutes(log);
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, routes),
      dragManager: manager,
      interceptors,
    };
    routeInputEvent(mouse(), ctx);

    expect(cancelCalls).toEqual([]);                    // no cancel on mouse
    // Mouse flows through fallback chain as normal.
    expect(log.map((e) => e.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
      'routeLogZoneClick',
    ]);
  });

  test('dragManager undefined → guard skipped · ESC falls through normally', () => {
    // Backward compat: dispatchers that don't wire a dragManager
    // (all pre-A-8 consumers, unit tests) behave exactly like
    // before A-8 landed. Post-I.2 this means: no interceptors field,
    // no dragManager field, straight viewMode arm dispatch.
    const log: Log = [];
    const routes = trackingRoutes(log);
    const ctx: DispatchContext = mkCtx(VM_IDLE, routes);
    // No dragManager field · no interceptors field.
    const outcome = routeInputEvent(k('escape'), ctx);

    expect(outcome).toBe('passthrough');
    expect(log.map((e) => e.name)).toEqual([
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('drag active on MODAL viewMode → ESC still cancelled by guard (wins over modal arm)', () => {
    // Invariant: drag ESC cancel wins over ALL viewMode arms.
    // Without the guard, ESC would route to routeToModal and close
    // the modal instead of cancelling the drag.
    const log: Log = [];
    const routes = trackingRoutes(log, { routeToModal: 'consumed' });
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_MODAL, routes),
      dragManager: manager,
      interceptors,
    };
    const outcome = routeInputEvent(k('escape'), ctx);

    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
    // modal arm NOT reached.
    expect(log).toEqual([]);
  });

  test('drag active on CHORD-ARMED viewMode → ESC cancels drag (not chord body)', () => {
    // Same invariant for chord-armed: drag ESC wins.
    const log: Log = [];
    const routes = trackingRoutes(log, { routeChord: 'consumed' });
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx({ kind: 'chord-armed', leader: 'ctrl+b' }, routes),
      dragManager: manager,
      interceptors,
    };
    const outcome = routeInputEvent(k('escape'), ctx);

    expect(outcome).toBe('consumed');
    expect(cancelCalls).toEqual(['escape']);
    expect(log).toEqual([]);
  });

  test('drag active ESC event includes shift/ctrl modifiers → still cancels', () => {
    // Edge: user presses Ctrl+Escape or Shift+Escape during drag.
    // The ESC guard is name-based · modifiers don't affect the check.
    const log: Log = [];
    const routes = trackingRoutes(log);
    const { manager, cancelCalls, interceptors } = mkDragManagerMock(true);
    const ctx: DispatchContext = {
      ...mkCtx(VM_IDLE, routes),
      dragManager: manager,
      interceptors,
    };
    routeInputEvent(k('escape', { ctrl: true, shift: true }), ctx);

    expect(cancelCalls).toEqual(['escape']);
  });
});
