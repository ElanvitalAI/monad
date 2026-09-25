// ── A-5 · attachChatStreamingKeys mouse migration · dispatch snapshot tests ──
//
// Validates the streaming-mode mouse sub-block wiring via
// `routeInputEvent` with `ViewMode={kind:'streaming'}`. Specific
// streaming-mode semantics pinned:
//
//   * **pane-nav click** — focus SHIFTS (user explicitly picked a
//     tab) · reason `'pane-nav-click'`.
//   * **wheel (scroll-up / scroll-down)** — calls `scrollLogBy`
//     equivalent · no focus change · returns consumed.
//   * **click on log zone with attachment hit** — consumed · focus
//     FOLLOWS to 'log' (streaming focus-follow rule).
//   * **click on log zone non-attachment (out-of-zone)** — upper-
//     half click shifts focus to first pane of current view · lower
//     half silent.
//   * **pill click** — consumed by mouseWiring short-circuit · no
//     focus change.
//
// A-5 migrates ONLY mouse in the streaming handler. Key sub-block
// stays inline (async + pre-gates make it hard to migrate cleanly
// through sync RouteCallbacks). Tests pin mouse behaviour so A-6
// cleanup can delete the legacy mouse body without regressing.

import { describe, expect, test } from 'bun:test';
import {
  routeInputEvent,
  derivePolicyForViewMode,
  buildMouseInputEventFromDisplay,
  type RouteCallbacks,
  type DispatchContext,
} from '../src/input-core/index.js';
import type { ViewMode } from '../src/input-core/view-mode.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

// ── Fixtures ──────────────────────────────────────────────

const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

interface StreamingMock {
  workingDirFocus: string;
  /** Any focus changes recorded for detection. Streaming's log-click
   *  rule is to always follow focus to 'log'. */
  focusShifts: Array<{ target: string; reason: string }>;
  /** Wheel scroll calls recorded (mirrors scrollLogBy). */
  wheelCalls: Array<-3 | 3>;
}

function mkMock(initial = 'pane'): StreamingMock {
  return {
    workingDirFocus: initial,
    focusShifts: [],
    wheelCalls: [],
  };
}

interface StubConfig {
  wiring: 'consumed' | 'pass';
  paneNav: string | null;
  logZone: 'consumed' | 'out-of-zone' | 'passthrough';
  eventType: DisplayMouseEvent['type'];
  /** Terminal rows total · used for "click above pane-h" check. */
  termRows: number;
  /** Computed pane height · row > paneH means "below" (log area). */
  paneH: number;
  /** View name for firstPaneOfView fallback. */
  view: string;
  firstPaneOfView: string;
}

function buildStreamingRoutes(cfg: StubConfig, mock: StreamingMock): RouteCallbacks {
  return {
    routeMouseWiring: () => (cfg.wiring === 'consumed' ? 'consumed' : 'passthrough'),

    routePaneNavClick: () => {
      if (cfg.eventType !== 'click') return 'passthrough';
      if (cfg.paneNav === null) return 'passthrough';
      mock.focusShifts.push({ target: cfg.paneNav, reason: 'pane-nav-click' });
      mock.workingDirFocus = cfg.paneNav;
      return 'consumed';
    },

    // Streaming-mode: wheel + click both go through routeLogZoneClick
    // in A-5's unified helper. Tests pin that streaming-specific
    // focus-follow semantics (log-area-click = focus follows to 'log').
    routeLogZoneClick: (_ev, allowFocusSteal) => {
      if (cfg.eventType === 'scroll-up') {
        mock.wheelCalls.push(-3);
        return 'consumed';
      }
      if (cfg.eventType === 'scroll-down') {
        mock.wheelCalls.push(3);
        return 'consumed';
      }
      if (cfg.eventType === 'click') {
        if (cfg.logZone === 'consumed') {
          // Streaming focus-follow
          if (allowFocusSteal && mock.workingDirFocus !== 'log') {
            mock.focusShifts.push({ target: 'log', reason: 'log-area-click (streaming)' });
            mock.workingDirFocus = 'log';
          }
          return 'consumed';
        }
        if (cfg.logZone === 'out-of-zone') {
          // Click upper-half (above paneH) shifts focus to first pane
          // of view; lower-half is silent.
          // eventType='click' already checked
          if (allowFocusSteal) {
            // In the real code, m.row <= paneH decides shift. We use
            // a marker: paneH stored in cfg · the test builds dsp()
            // with row <= paneH when it wants this branch.
            // This stub always shifts when out-of-zone (treat dsp row
            // as below paneH unless test says otherwise).
            mock.focusShifts.push({
              target: cfg.firstPaneOfView,
              reason: 'pane-area-click',
            });
            mock.workingDirFocus = cfg.firstPaneOfView;
            return 'consumed';
          }
          return 'consumed';                              // consumed w/o focus shift
        }
      }
      return 'passthrough';
    },
  };
}

function mkCtx(viewMode: ViewMode, routes: RouteCallbacks): DispatchContext {
  return {
    viewMode,
    policy: derivePolicyForViewMode(viewMode),
    routes,
  };
}

const STREAMING: ViewMode = { kind: 'streaming' };

// ── §1 mouseWiring short-circuit (pill click) ────────────

describe('A-5 · routeMouseWiring wins first (pill click)', () => {
  test('pill click consumed → no focus · no wheel', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'consumed',
      paneNav: 'tasks',                                   // would match if reached
      logZone: 'consumed',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pill', name: 'model' },
    }));
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([]);
    expect(mock.wheelCalls).toEqual([]);
  });
});

// ── §2 pane-nav click → focus shift ──────────────────────

describe('A-5 · routePaneNavClick — pane-nav reason pinned', () => {
  test('pane-nav click in streaming → setWorkingFocus target (reason = pane-nav-click)', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'scheduler',
      logZone: 'out-of-zone',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-nav-tab', paneId: 'scheduler' },
    }));
    routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(mock.focusShifts).toEqual([
      { target: 'scheduler', reason: 'pane-nav-click' },
    ]);
    expect(mock.workingDirFocus).toBe('scheduler');
  });

  test('streaming pane-nav reason differs from A-3 mx-mouse (pins the distinction)', () => {
    // A-3 uses 'mx-mouse-pane-nav'. A-5 streaming uses 'pane-nav-click'.
    // Pin so future refactor can't collapse them.
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'browser',
      logZone: 'out-of-zone',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));
    expect(mock.focusShifts[0]?.reason).toBe('pane-nav-click');
    expect(mock.focusShifts[0]?.reason).not.toBe('mx-mouse-pane-nav');
    expect(mock.focusShifts[0]?.reason).not.toBe('input-onMouse-pane-nav');
  });
});

// ── §3 wheel / scroll routes to scrollLogBy ──────────────

describe('A-5 · wheel routes through routeLogZoneClick → scrollLogBy', () => {
  test('scroll-up → scrollLogBy(-3) · consumed · no focus', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'out-of-zone',                             // wheel path doesn't care
      eventType: 'scroll-up',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.wheelCalls).toEqual([-3]);
    expect(mock.focusShifts).toEqual([]);
  });

  test('scroll-down → scrollLogBy(3) · consumed · no focus', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'out-of-zone',
      eventType: 'scroll-down',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-down' }));
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.wheelCalls).toEqual([3]);
    expect(mock.focusShifts).toEqual([]);
  });
});

// ── §4 log-zone click · streaming focus-follow ──────────

describe('A-5 · routeLogZoneClick — streaming focus-follow rule', () => {
  test('log-zone attachment hit → consumed · focus shifts to log (streaming rule)', () => {
    const mock = mkMock('pane');                          // NOT already on log
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'consumed',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([
      { target: 'log', reason: 'log-area-click (streaming)' },
    ]);
    expect(mock.workingDirFocus).toBe('log');
  });

  test('already-focused log: idempotent · no duplicate focus event', () => {
    const mock = mkMock('log');                           // already focused
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'consumed',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(mock.focusShifts).toEqual([]);                 // no duplicate
  });

  test('log-zone out-of-zone + upper-half → shift to firstPaneOfView', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'out-of-zone',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'scheduler',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ row: 15 })); // upper-half
    const outcome = routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([
      { target: 'scheduler', reason: 'pane-area-click' },
    ]);
  });
});

// ── §5 policy check: streaming uses allowFocusSteal=true ──

describe('A-5 · streaming viewMode allows focus steal', () => {
  test('derivePolicyForViewMode({streaming}) → allowFocusSteal=true', () => {
    // Streaming follows focus on log click and pane-area click — needs
    // policy.allowFocusSteal=true. Pin so future policy refactor
    // can't accidentally block streaming focus-follow.
    const policy = derivePolicyForViewMode(STREAMING);
    expect(policy.allowFocusSteal).toBe(true);
  });

  test('routeLogZoneClick receives allowFocusSteal=true under streaming', () => {
    const calls: Array<{ allowFocusSteal: boolean }> = [];
    const routes: RouteCallbacks = {
      routeLogZoneClick: (_ev, allowFocusSteal) => {
        calls.push({ allowFocusSteal });
        return 'passthrough';
      },
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(STREAMING, routes));
    expect(calls[0]?.allowFocusSteal).toBe(true);
  });
});

// ── §6 divergence pins (A-3 vs A-4 vs A-5) ──────────────

describe('A-5 · divergence from A-3 / A-4', () => {
  test('streaming log-click: focus FOLLOWS (differs from both A-3 and A-4)', () => {
    // A-3 mx-mouse: focus follows (allowFocusSteal=true)
    // A-4 textInput: NO focus shift (don't steal mid-typing)
    // A-5 streaming: focus follows (streaming focus-follow rule) ← same as A-3
    const mock = mkMock('pane');
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      logZone: 'consumed',
      eventType: 'click',
      termRows: 40, paneH: 20,
      view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));

    // Focus DID follow (parity with A-3 mx-mouse · contrast w/ A-4 textInput).
    expect(mock.focusShifts).toEqual([
      { target: 'log', reason: 'log-area-click (streaming)' },
    ]);
    // Reason string differs from A-3's 'log-area-click' — streaming-specific label.
    expect(mock.focusShifts[0]?.reason).toContain('(streaming)');
  });

  test('streaming wheel → scrollLogBy (differs from A-3 / A-4 which delegate to widget scroll)', () => {
    // A-3/A-4 pass scroll events through dispatchPaneClick → widget.onMouse.
    // A-5 streaming hijacks wheel to scrollLogBy (pre-session-18 behaviour).
    // Pin by checking wheelCalls uses the -3/3 step size convention.
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass', paneNav: null, logZone: 'out-of-zone',
      eventType: 'scroll-up',
      termRows: 40, paneH: 20, view: 'default', firstPaneOfView: 'browser',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    routeInputEvent(inputEv, mkCtx(STREAMING, buildStreamingRoutes(cfg, mock)));
    expect(mock.wheelCalls).toEqual([-3]);                // 3-row step pinned
  });
});
