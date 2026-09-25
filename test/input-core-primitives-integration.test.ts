// ── Input-core primitives integration test ──
//
// Composes all three U-2a / U-3 prep primitives end-to-end in realistic
// event flows:
//
//     DisplayMouseEvent  ─▶  buildMouseInputEventFromDisplay  ─▶  routeInputEvent
//              │                         (U-3 prep)                 (U-2a scaffold)
//              │                              │                            │
//              │                              ▼                            ▼
//              └── (hit target)          MouseInputEvent          DispatchOutcome
//                                        with real target
//                                              │
//                                              └── (also used by)  hitTestAllSurfaces
//                                                                      (U-2a scaffold)
//
// Why this test exists
//   - A-1 (PR #298) wired buildMouseInputEventFromDisplay into the
//     input-core handler but did not prove the three primitives
//     compose cleanly in one flow. A-3 is the first PR that actually
//     routes a mouse event through routeInputEvent inside the
//     dashboard; before that edit lands, this integration test gives
//     us high-confidence evidence that "the wire diagram works" using
//     pure stubs. That way A-3's risk is confined to "did I wire it
//     into dashboard.ts correctly", not "do the primitives even
//     compose".
//   - Also pins the contract that mouse-bridge's `target` output flows
//     directly into routeInputEvent's callback signature without any
//     adapter glue. Future API shape changes to either primitive will
//     fail this test and call attention before a dashboard migration
//     silently breaks.
//
// Not in scope
//   - Real dashboard wiring (A-3 onward).
//   - resolveInputEvent / binding lookup (that's U-2a's dispatcher-level
//     concern — this file tests composition, not the resolver).
//   - Real terminal / mouse-wiring callbacks — we stub each route.
//
// Style convention
//   Every test is "given a display event, trace it end-to-end". Each
//   case asserts (a) the resulting MouseInputEvent shape and (b) which
//   route callback the dispatcher invoked with what arguments.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  derivePolicyForViewMode,
  hitTestAllSurfaces,
  buildMouseInputEventFromDisplay,
  type DispatchContext,
  type DispatchOutcome,
  type RouteCallbacks,
  type HitTestDeps,
  type InputEvent,
  type MouseInputEvent,
  type HitTarget as InputCoreHitTarget,
} from '../src/input-core/index.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

// ── Fixtures ───────────────────────────────────────────────

const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

interface RouteCall {
  name: keyof RouteCallbacks;
  ev: InputEvent;
  allowFocusSteal?: boolean;
}

interface HarnessOpts {
  viewMode: ViewMode;
  /** Which route callback should return 'consumed'. When omitted, all
   *  routes return 'passthrough' so the fallback chain runs. */
  consumeAt?: keyof RouteCallbacks;
  /** Override the derived policy — mostly unused, left for the
   *  "explicit policy" test. */
  policy?: { allowFocusSteal: boolean };
}

function makeHarness(opts: HarnessOpts): {
  ctx: DispatchContext;
  calls: RouteCall[];
} {
  const calls: RouteCall[] = [];
  const record = (name: keyof RouteCallbacks): DispatchOutcome =>
    opts.consumeAt === name ? 'consumed' : 'passthrough';

  const routes: RouteCallbacks = {
    routeToTerminalModal: (ev) => {
      calls.push({ name: 'routeToTerminalModal', ev });
      return record('routeToTerminalModal');
    },
    routeToModal: (ev) => {
      calls.push({ name: 'routeToModal', ev });
      return record('routeToModal');
    },
    routeToPlugin: (ev) => {
      calls.push({ name: 'routeToPlugin', ev });
      return record('routeToPlugin');
    },
    routeChord: (ev) => {
      calls.push({ name: 'routeChord', ev });
      return record('routeChord');
    },
    routeStreamingKey: (ev) => {
      calls.push({ name: 'routeStreamingKey', ev });
      return record('routeStreamingKey');
    },
    routeMouseWiring: (ev) => {
      calls.push({ name: 'routeMouseWiring', ev });
      return record('routeMouseWiring');
    },
    routePaneNavClick: (ev) => {
      calls.push({ name: 'routePaneNavClick', ev });
      return record('routePaneNavClick');
    },
    routePaneClick: (ev, allowFocusSteal) => {
      calls.push({ name: 'routePaneClick', ev, allowFocusSteal });
      return record('routePaneClick');
    },
    routeLogZoneClick: (ev, allowFocusSteal) => {
      calls.push({ name: 'routeLogZoneClick', ev, allowFocusSteal });
      return record('routeLogZoneClick');
    },
    routeFocusedWidgetKey: (ev) => {
      calls.push({ name: 'routeFocusedWidgetKey', ev });
      return record('routeFocusedWidgetKey');
    },
    routeGlobalBindings: (ev) => {
      calls.push({ name: 'routeGlobalBindings', ev });
      return record('routeGlobalBindings');
    },
  };

  const ctx: DispatchContext = {
    viewMode: opts.viewMode,
    policy: opts.policy ?? derivePolicyForViewMode(opts.viewMode),
    routes,
  };
  return { ctx, calls };
}

// ── Integration: bridge → dispatcher, target propagation ───

describe('integration · mouse-bridge → dispatcher', () => {
  test('pill click on idle: bridge produces pill target, dispatcher routes through mouseWiring', () => {
    const display = dsp({
      type: 'click',
      row: 1, col: 5,
      hitTarget: { kind: 'pill', name: 'model' },
    });

    // Step 1 — bridge: display event becomes input-core envelope
    //          with `target.kind === 'pill'`.
    const inputEv = buildMouseInputEventFromDisplay(display);
    expect(inputEv.kind).toBe('mouse');
    expect(inputEv.type).toBe('click');
    expect(inputEv.target).toEqual({ kind: 'pill', name: 'model' });

    // Step 2 — dispatcher on idle routes through mouse fallback
    //          chain; first stop is mouseWiring.
    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routeMouseWiring',
    });
    const outcome = routeInputEvent(inputEv, ctx);
    expect(outcome).toBe('consumed');
    // First invocation was routeMouseWiring with the bridged event
    // — the `target` field must be preserved end-to-end.
    expect(calls[0]?.name).toBe('routeMouseWiring');
    const delivered = calls[0]?.ev as MouseInputEvent;
    expect(delivered.target).toEqual({ kind: 'pill', name: 'model' });
  });

  test('pane-body click on input-mode: dispatcher delivers allowFocusSteal=false to routePaneClick', () => {
    // This is the end-to-end version of "textInput.onMouse doesn't
    // steal focus mid-typing" — once A-3 delegates to routeInputEvent,
    // the policy flag is the load-bearing gate.
    const display = dsp({
      type: 'click',
      row: 20, col: 40,
      hitTarget: { kind: 'pane-body', paneId: 'browser', widgetInstanceId: 'wd-browser-1' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'input' },
      consumeAt: 'routePaneClick',
    });
    const outcome = routeInputEvent(inputEv, ctx);
    expect(outcome).toBe('consumed');

    const paneClick = calls.find((c) => c.name === 'routePaneClick');
    expect(paneClick).toBeDefined();
    expect(paneClick!.allowFocusSteal).toBe(false);
    // target survives end-to-end.
    const delivered = paneClick!.ev as MouseInputEvent;
    expect(delivered.target).toEqual({
      kind: 'pane-body',
      paneId: 'browser',
      widgetInstanceId: 'wd-browser-1',
    });
  });

  test('same pane-body click on idle: allowFocusSteal=true (focus shift allowed)', () => {
    const display = dsp({
      type: 'click', row: 20, col: 40,
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routePaneClick',
    });
    routeInputEvent(inputEv, ctx);
    expect(calls.find((c) => c.name === 'routePaneClick')?.allowFocusSteal).toBe(true);
  });

  test('modal-body click goes through modal route (α.2 · exact translate)', () => {
    // Option α.2 · modal-body is now mirrored exactly in the input-core
    // HitTarget union. The bridge preserves `modalId`. Binding tables
    // can scope to `click:modal-body.<modalId>` · the dispatcher still
    // routes to routeToModal under viewMode='modal'.
    const display = dsp({
      type: 'click', row: 15, col: 25,
      hitTarget: { kind: 'modal-body', modalId: 'dlg-1', itemIndex: 2 },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);
    expect(inputEv.target).toEqual({ kind: 'modal-body', modalId: 'dlg-1' });

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'modal', modalId: 'dlg-1' },
      consumeAt: 'routeToModal',
    });
    const outcome = routeInputEvent(inputEv, ctx);
    expect(outcome).toBe('consumed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('routeToModal');
  });

  test('vw-pane-body with numeric string windowId coerces cleanly', () => {
    const display = dsp({
      type: 'scroll-up', row: 10, col: 20,
      hitTarget: { kind: 'vw-pane-body', windowId: '3', paneId: 'editor' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);
    expect(inputEv.target).toEqual({
      kind: 'vw-pane-body', windowId: 3, paneId: 'editor',
    });

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routeMouseWiring',
    });
    routeInputEvent(inputEv, ctx);
    const delivered = calls[0]?.ev as MouseInputEvent;
    expect(delivered.type).toBe('scroll-up');
    expect(delivered.target).toEqual({
      kind: 'vw-pane-body', windowId: 3, paneId: 'editor',
    });
  });
});

// ── Integration: hit-test as bridge source ────────────────

describe('integration · hit-test → bridge → dispatcher', () => {
  test('hit-test output is usable as DisplayMouseEvent.hitTarget input', () => {
    // Realistic flow: mouseWiring layer runs hitTestAllSurfaces at
    // cursor position → synthesizes DisplayMouseEvent with that
    // hitTarget → bridge converts → dispatcher routes.
    const hitDeps: HitTestDeps = {
      tryPill: () => null,
      tryPaneNavTab: (_r, _c) => ({ kind: 'pane-nav-tab', paneId: 'tasks' }),
      tryPaneCell: () => null,
      tryLogZone: () => null,
      tryStatusBar: () => null,
    };
    const hit = hitTestAllSurfaces(2, 8, hitDeps);
    expect(hit).toEqual({ kind: 'pane-nav-tab', paneId: 'tasks' });

    // Now use the hit as hitTarget on a display event. The type
    // system demands `hit` is an input-core HitTarget; to feed it
    // back into a DisplayMouseEvent we assert it narrowly — this
    // identity round-trip is the integration contract U-3 full
    // (A-7) relies on.
    // NOTE: In real code, hitTestAllSurfaces callbacks return the
    // input-core HitTarget (from event.ts), which happens to overlap
    // the display HitTarget for these kinds. A-7 may promote the
    // union to be identical; for now the overlap is enough.
    const display = dsp({
      hitTarget: hit as unknown as DisplayMouseEvent['hitTarget'],
    });
    const inputEv = buildMouseInputEventFromDisplay(display);
    expect(inputEv.target).toEqual({ kind: 'pane-nav-tab', paneId: 'tasks' });

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routePaneNavClick',
    });
    routeInputEvent(inputEv, ctx);
    const paneNav = calls.find((c) => c.name === 'routePaneNavClick');
    expect(paneNav).toBeDefined();
    expect((paneNav!.ev as MouseInputEvent).target).toEqual({
      kind: 'pane-nav-tab', paneId: 'tasks',
    });
  });

  test('hit-test misses all surfaces: bridge defaults to unknown, dispatcher still runs fallback chain', () => {
    const hit = hitTestAllSurfaces(50, 50, {});
    expect(hit).toBeNull();

    const display = dsp({ row: 50, col: 50 });  // no hitTarget → bridge outputs unknown
    const inputEv = buildMouseInputEventFromDisplay(display);
    expect(inputEv.target).toEqual({ kind: 'unknown' });

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      // no consumeAt → all routes passthrough, last in chain runs
    });
    const outcome = routeInputEvent(inputEv, ctx);
    expect(outcome).toBe('passthrough');
    // All four mouse-fallback routes were tried in order.
    expect(calls.map((c) => c.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
      'routeLogZoneClick',
    ]);
  });
});

// ── Integration: view-mode arm priority ───────────────────

describe('integration · viewMode arm priority end-to-end', () => {
  test('terminal-modal arm wins regardless of hitTarget', () => {
    // Even if the mouse event has a rich hitTarget (e.g. pane-body),
    // terminal-modal viewMode short-circuits to its arm before any
    // fallback runs. This pins the dispatcher's contract that
    // viewMode is the PRIMARY discriminator.
    const display = dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'terminal-modal', terminalId: 't-1' },
      consumeAt: 'routeToTerminalModal',
    });
    routeInputEvent(inputEv, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('routeToTerminalModal');
  });

  test('chord-armed key does NOT fall through to idle key chain even if routeChord passes through', () => {
    // Chord passthrough must NOT invoke routeFocusedWidgetKey /
    // routeGlobalBindings — doing so would mis-dispatch the chord
    // body letter.
    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'chord-armed', leader: 'ctrl+b' },
      // no consumeAt → routeChord passthroughs; MUST NOT fall through
    });
    const keyEv: InputEvent = {
      kind: 'key',
      key: { name: 'a', ctrl: false, shift: false },
    };
    const outcome = routeInputEvent(keyEv, ctx);
    expect(outcome).toBe('passthrough');
    expect(calls.map((c) => c.name)).toEqual(['routeChord']);
  });

  test('streaming key falls through key chain when routeStreamingKey passes through', () => {
    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'streaming' },
      consumeAt: 'routeGlobalBindings',
    });
    const keyEv: InputEvent = {
      kind: 'key',
      key: { name: 'j', ctrl: false, shift: false },
    };
    routeInputEvent(keyEv, ctx);
    expect(calls.map((c) => c.name)).toEqual([
      'routeStreamingKey',
      'routeFocusedWidgetKey',
      'routeGlobalBindings',
    ]);
  });

  test('streaming mouse uses idle-style fallback chain (streaming does not grab pointer)', () => {
    const display = dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'streaming' },
      consumeAt: 'routeLogZoneClick',
    });
    routeInputEvent(inputEv, ctx);
    expect(calls.map((c) => c.name)).toEqual([
      'routeMouseWiring',
      'routePaneNavClick',
      'routePaneClick',
      'routeLogZoneClick',
    ]);
  });
});

// ── Integration: modifier keys round-trip ─────────────────

describe('integration · modifier keys end-to-end', () => {
  test('ctrl+click survives bridge and reaches route callback with ctrl:true', () => {
    const display = dsp({
      type: 'click',
      hitTarget: { kind: 'pill', name: 'model' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display, { ctrl: true });
    expect(inputEv.ctrl).toBe(true);
    expect('shift' in inputEv).toBe(false);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routeMouseWiring',
    });
    routeInputEvent(inputEv, ctx);
    const delivered = calls[0]?.ev as MouseInputEvent;
    expect(delivered.ctrl).toBe(true);
    expect('shift' in delivered).toBe(false);
  });

  test('no modifiers → event has none of shift/ctrl/alt set', () => {
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    expect('shift' in inputEv).toBe(false);
    expect('ctrl' in inputEv).toBe(false);
    expect('alt' in inputEv).toBe(false);
  });

  test('all three modifiers survive round-trip', () => {
    const inputEv = buildMouseInputEventFromDisplay(
      dsp(),
      { shift: true, ctrl: true, alt: true },
    );
    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      consumeAt: 'routePaneClick',
    });
    routeInputEvent(inputEv, ctx);
    const delivered = calls.find((c) => c.name === 'routePaneClick')?.ev as MouseInputEvent;
    expect(delivered.shift).toBe(true);
    expect(delivered.ctrl).toBe(true);
    expect(delivered.alt).toBe(true);
  });
});

// ── Integration: target kind preserved across arms ────────

describe('integration · target kind preservation', () => {
  const kinds: Array<[string, InputCoreHitTarget]> = [
    ['pill',          { kind: 'pill', name: 'model' }],
    ['pane-nav-tab',  { kind: 'pane-nav-tab', paneId: 'x' }],
    ['pane-title',    { kind: 'pane-title', paneId: 'x' }],
    ['pane-body',     { kind: 'pane-body', paneId: 'x' }],
    ['status-bar',    { kind: 'status-bar' }],
    ['unknown',       { kind: 'unknown' }],
  ];

  for (const [label, target] of kinds) {
    test(`target kind '${label}' survives bridge→dispatcher on idle`, () => {
      // Construct the display-layer equivalent (this is essentially
      // the round-trip proof the bridge provides for direct-peer kinds).
      const display = dsp({
        hitTarget:
          target.kind === 'unknown'
            ? undefined
            : target as unknown as DisplayMouseEvent['hitTarget'],
      });
      const inputEv = buildMouseInputEventFromDisplay(display);
      expect(inputEv.target).toEqual(target);

      const { ctx, calls } = makeHarness({
        viewMode: { kind: 'idle' },
        consumeAt: 'routeMouseWiring',
      });
      routeInputEvent(inputEv, ctx);
      const delivered = calls[0]?.ev as MouseInputEvent;
      expect(delivered.target).toEqual(target);
    });
  }
});

// ── Integration: explicit policy override ─────────────────

describe('integration · explicit policy override', () => {
  test('caller can force allowFocusSteal=false even on idle', () => {
    // e.g. a plugin context might want input-mode semantics under
    // idle viewMode for its own reasons. The dispatcher respects
    // the caller-provided policy without re-deriving.
    const display = dsp({
      hitTarget: { kind: 'pane-body', paneId: 'plugin-pane' },
    });
    const inputEv = buildMouseInputEventFromDisplay(display);

    const { ctx, calls } = makeHarness({
      viewMode: { kind: 'idle' },
      policy: { allowFocusSteal: false },  // explicit override
      consumeAt: 'routePaneClick',
    });
    routeInputEvent(inputEv, ctx);
    expect(calls.find((c) => c.name === 'routePaneClick')?.allowFocusSteal).toBe(false);
  });
});
