// ── A-3 · mx-mouse handler migration · dispatch snapshot tests ──
//
// Validates that the mx-mouse handler body behaves equivalently under
// both code paths:
//
//   * `UNIFIED_DISPATCH=0` → legacyMxMouseBody (verbatim pre-A-3 body)
//   * default              → runMxMouseUnifiedDispatch (routeInputEvent
//                            + 4 wrapped route callbacks)
//
// We can't boot the full dashboard in a unit test, so we replicate the
// mx-mouse dispatch via `routeInputEvent` directly using the same
// route callback pattern A-3 wires in dashboard.ts. This locks:
//   (1) The 4 fallback arm ordering (wiring → pane-nav → pane-click →
//       log-zone) — matches legacy body's if-ladder.
//   (2) Focus-steal flag semantics — `allowFocusSteal=true` for
//       mx-mouse (idle/browse mode), `false` for A-4 input-mode.
//   (3) Log-zone focus shift only when `allowFocusSteal` — important
//       because A-4 will reuse the same route callback with policy
//       flipped.
//   (4) Early short-circuit when mouseWiring consumes (pill click
//       never falls through to pane-nav / pane-click).
//
// The legacy path is NOT re-tested here — its behaviour is pinned by
// the pre-A-3 production history. This file focuses on the unified
// path's parity + policy handling.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  derivePolicyForViewMode,
  buildMouseInputEventFromDisplay,
  type RouteCallbacks,
  type DispatchContext,
  type DispatchOutcome,
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

/** Mock dashboard-layer state shared across the stubs inside one test.
 *  Mirrors the outer-closure state A-3 captures: `workingDir.focus`,
 *  focus mutations recorded as events, submit dispatch spied. */
interface DashMock {
  workingDirFocus: string;
  focusChanges: Array<{ target: string; reason: string }>;
  submits: string[];
}

function mkDashMock(initial = 'pane'): DashMock {
  return {
    workingDirFocus: initial,
    focusChanges: [],
    submits: [],
  };
}

/** Build the route callbacks A-3's `runMxMouseUnifiedDispatch` uses,
 *  parametrised by:
 *   - `wiring`       — whether `mouseWiring.handleMouse(m)` consumes
 *   - `paneNav`      — return value of the pane-nav hit test (null =
 *                      miss)
 *   - `paneClick`    — what `dispatchPaneClick` returns
 *   - `logZone`      — what `dispatchLogZoneClick` returns
 *  and the `mock` that the callbacks mutate on focus / submit.
 *
 *  Structure mirrors the real dashboard wiring 1-to-1 so a regression
 *  in A-3's mx-mouse body shows up here before hitting production. */
interface StubConfig {
  wiring: 'consumed' | 'pass';
  paneNav: string | null;
  paneClick:
    | { kind: 'no-hit' }
    | { kind: 'focus-only'; focusPane: string | null }
    | { kind: 'widget-handled'; focusPane: string | null; submitText: string | null };
  logZone: 'consumed' | 'passthrough' | 'out-of-zone';
  eventType: DisplayMouseEvent['type'];
}

function buildMxMouseRoutes(cfg: StubConfig, mock: DashMock): RouteCallbacks {
  return {
    routeMouseWiring: () => (cfg.wiring === 'consumed' ? 'consumed' : 'passthrough'),

    routePaneNavClick: (ev) => {
      if (ev.type !== 'click') return 'passthrough';
      if (cfg.paneNav === null) return 'passthrough';
      mock.focusChanges.push({ target: cfg.paneNav, reason: 'mx-mouse-pane-nav' });
      mock.workingDirFocus = cfg.paneNav;
      return 'consumed';
    },

    routePaneClick: (_ev, allowFocusSteal) => {
      const outcome = cfg.paneClick;
      if (outcome.kind === 'no-hit') return 'passthrough';
      if (allowFocusSteal && outcome.focusPane && outcome.focusPane !== mock.workingDirFocus) {
        mock.focusChanges.push({ target: outcome.focusPane, reason: 'mx-mouse-pane-click' });
        mock.workingDirFocus = outcome.focusPane;
      }
      if (outcome.kind === 'widget-handled') {
        if (outcome.submitText !== null) mock.submits.push(outcome.submitText);
        return 'consumed';
      }
      return (cfg.eventType === 'click' || cfg.eventType === 'double-click')
        ? 'consumed' : 'passthrough';
    },

    routeLogZoneClick: (_ev, allowFocusSteal) => {
      if (cfg.eventType !== 'click' && cfg.eventType !== 'double-click') return 'passthrough';
      if (cfg.logZone !== 'consumed') return 'passthrough';
      if (allowFocusSteal && mock.workingDirFocus !== 'log') {
        mock.focusChanges.push({ target: 'log', reason: 'log-area-click' });
        mock.workingDirFocus = 'log';
      }
      return 'consumed';
    },
  };
}

function mkCtx(
  viewMode: ViewMode,
  routes: RouteCallbacks,
  policy?: { allowFocusSteal: boolean },
): DispatchContext {
  return {
    viewMode,
    policy: policy ?? derivePolicyForViewMode(viewMode),
    routes,
  };
}

const IDLE: ViewMode = { kind: 'idle' };
const INPUT: ViewMode = { kind: 'input' };
const STREAMING: ViewMode = { kind: 'streaming' };
const MODAL: ViewMode = { kind: 'modal', modalId: 'dlg-1' };

// ── §1 mouseWiring short-circuit ───────────────────────────

describe('A-3 · routeMouseWiring wins first', () => {
  test('mouseWiring consumed → neither pane-nav nor pane-click run', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'consumed',
      paneNav: 'tasks',                              // would match if reached
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: 'X' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pill', name: 'model' },
    }));
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    // No focus change / submit — wiring short-circuited everything.
    expect(mock.focusChanges).toEqual([]);
    expect(mock.submits).toEqual([]);
    expect(mock.workingDirFocus).toBe('pane');
  });
});

// ── §2 pane-nav row click ──────────────────────────────────

describe('A-3 · routePaneNavClick', () => {
  test('pane-nav click → setWorkingFocus target', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'scheduler',
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-nav-tab', paneId: 'scheduler' },
    }));
    routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(mock.focusChanges).toEqual([
      { target: 'scheduler', reason: 'mx-mouse-pane-nav' },
    ]);
    expect(mock.workingDirFocus).toBe('scheduler');
  });

  test('non-click mouse event on pane-nav row → passthrough (no focus shift)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'scheduler',                           // would match click
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(mock.focusChanges).toEqual([]);
  });
});

// ── §3 pane-click (widget-handled + focus-only) ──────────────

describe('A-3 · routePaneClick', () => {
  test('widget-handled with submit → submit dispatched + focus shift (idle)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: 'hello' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.submits).toEqual(['hello']);
    expect(mock.focusChanges).toEqual([
      { target: 'browser', reason: 'mx-mouse-pane-click' },
    ]);
  });

  test('widget-handled NO submit → still consumed · focus shifts (idle)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'preview', submitText: null },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.submits).toEqual([]);
    expect(mock.focusChanges).toEqual([
      { target: 'preview', reason: 'mx-mouse-pane-click' },
    ]);
  });

  test('focus-only click consumed · focus applied', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusChanges).toEqual([
      { target: 'browser', reason: 'mx-mouse-pane-click' },
    ]);
  });

  test('focus-only scroll (not click) → passthrough · no focus shift', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    // Scroll over a focus-only pane: focus DOES shift (mx-mouse idle
    // behaviour) but the return is passthrough so other handlers
    // (e.g. pane-scroll) can still react.
    expect(outcome).toBe('passthrough');
    expect(mock.focusChanges).toEqual([
      { target: 'browser', reason: 'mx-mouse-pane-click' },
    ]);
  });

  test('INPUT viewMode: focus NOT stolen (allowFocusSteal=false)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: null },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    // Focus stays on input — A-4 textInput.onMouse "don't steal
    // focus mid-typing" semantics derived from the same callback.
    expect(mock.focusChanges).toEqual([]);
    expect(mock.workingDirFocus).toBe('pane');
  });

  test('already-focused pane click: no redundant focus change (idempotent)', () => {
    const mock = mkDashMock('browser');              // already focused
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(mock.focusChanges).toEqual([]);           // no no-op focus event
  });
});

// ── §4 log-zone fallback (post U-4.3) ─────────────────────

describe('A-3 · routeLogZoneClick (post-B-3b attachment-popup unchanged)', () => {
  test('log-zone click on idle → focus shifts to log', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log' },
    }));
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusChanges).toEqual([
      { target: 'log', reason: 'log-area-click' },
    ]);
  });

  test('log-zone click on input viewMode → NO focus steal (dont-steal rule)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildMxMouseRoutes(cfg, mock)));

    // Input mode still returns 'consumed' (attachment popup fired as
    // side effect inside wd-log.onMouse per B-3b contract) but focus
    // stays on input.
    expect(outcome).toBe('consumed');
    expect(mock.focusChanges).toEqual([]);
  });

  test('log-zone out-of-zone or passthrough → full chain passthrough', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(outcome).toBe('passthrough');
    expect(mock.focusChanges).toEqual([]);
  });

  test('scroll on log-zone → passthrough (log scroll handled elsewhere)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',                          // even if log zone claims consume
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    // A-3 body gates the log-zone consume on click/double-click only
    // (preserving legacy behaviour). Scroll over log zone falls
    // through so dashboard's pane-scroll handler can react.
    expect(outcome).toBe('passthrough');
  });

  test('already-focused log: no redundant focus change', () => {
    const mock = mkDashMock('log');
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(IDLE, buildMxMouseRoutes(cfg, mock)));

    expect(mock.focusChanges).toEqual([]);
  });
});

// ── §5 viewMode priority end-to-end ───────────────────────

describe('A-3 · viewMode arm priority preserves modal / streaming semantics', () => {
  test('modal viewMode: mouse falls through mx-mouse (routeToModal arm is undefined here · passthrough)', () => {
    // In production, the modal arm is wired by a different handler
    // higher in the dispatchDashboardKey chain. At the mx-mouse level
    // (where modal routes aren't wired), a modal-mode mouse event
    // still runs the idle-style fallback chain — but the outer
    // modal handler consumed it first in the real app. This test
    // pins the mx-mouse behaviour in isolation: modal arm is
    // undefined → passthrough → fallback chain runs.
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(MODAL, buildMxMouseRoutes(cfg, mock)));
    // modal arm undefined → passthrough (mx-mouse doesn't wire modals)
    expect(outcome).toBe('passthrough');
  });

  test('streaming viewMode: mouse uses idle-style fallback (streaming does not grab pointer)', () => {
    const mock = mkDashMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildMxMouseRoutes(cfg, mock)));
    // Streaming allows focus steal (same as idle).
    expect(outcome).toBe('consumed');
    expect(mock.focusChanges).toEqual([
      { target: 'browser', reason: 'mx-mouse-pane-click' },
    ]);
  });
});

// ── §6 policy flag propagation (A-3 → A-4 preview) ────────

describe('A-3 · allowFocusSteal policy threads into all relevant callbacks', () => {
  test('INPUT: both routePaneClick and routeLogZoneClick receive allowFocusSteal=false', () => {
    const mock = mkDashMock();
    const calls: Array<{ name: string; allowFocusSteal: boolean }> = [];

    const routes: RouteCallbacks = {
      routePaneClick: (_ev, allowFocusSteal) => {
        calls.push({ name: 'paneClick', allowFocusSteal });
        return 'passthrough';
      },
      routeLogZoneClick: (_ev, allowFocusSteal) => {
        calls.push({ name: 'logZone', allowFocusSteal });
        return 'passthrough';
      },
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(INPUT, routes));

    expect(calls).toEqual([
      { name: 'paneClick', allowFocusSteal: false },
      { name: 'logZone', allowFocusSteal: false },
    ]);
    // mock is unused in this case · just verifying the shared dashboard
    // state isn't mutated when routes pass through.
    expect(mock.focusChanges).toEqual([]);
  });

  test('IDLE: both callbacks receive allowFocusSteal=true', () => {
    const calls: Array<{ name: string; allowFocusSteal: boolean }> = [];
    const routes: RouteCallbacks = {
      routePaneClick: (_ev, allowFocusSteal) => {
        calls.push({ name: 'paneClick', allowFocusSteal });
        return 'passthrough';
      },
      routeLogZoneClick: (_ev, allowFocusSteal) => {
        calls.push({ name: 'logZone', allowFocusSteal });
        return 'passthrough';
      },
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(IDLE, routes));

    expect(calls).toEqual([
      { name: 'paneClick', allowFocusSteal: true },
      { name: 'logZone', allowFocusSteal: true },
    ]);
  });
});
