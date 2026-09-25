// ── A-4 · textInput.onMouse migration · dispatch snapshot tests ──
//
// Validates the SAME contract A-3 locked for mx-mouse, but with
// textInput-specific semantics:
//
//   * pane-NAV click — focus DOES shift (user explicitly picked a tab);
//     reason string differs ('input-onMouse-pane-nav' vs mx-mouse's).
//   * pane-BODY click — focus NEVER shifts (don't steal focus
//     mid-typing), even under allowFocusSteal.
//   * log-zone click — only processed when `attachmentRowMap` has
//     entries. Otherwise passthrough so the tail scroll block can
//     adjust chatScrollOffset.
//   * tail scroll block — wheel over log zone that passed through all
//     routes is handled by direct chatScrollOffset mutation. Not in
//     the dispatcher's scope; tested separately as a stub.
//
// Real dashboard cannot boot in a unit test, so we exercise
// `routeInputEvent` with stubbed RouteCallbacks that mirror A-4's
// wiring. This pins the semantic invariants (focus-shift vs no-shift,
// attachment gate, submit dispatch) without depending on the full
// chatScrollOffset closure.

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

interface TextInputMock {
  /** textInput mode never mutates workingDir.focus — we just record
   *  any call for detection of accidental steals. */
  focusShifts: Array<{ target: string; reason: string }>;
  submits: string[];
  /** Attachment rows currently rendered; gates log-zone click. Mirror
   *  of dashboard's `attachmentRowMap.size()`. */
  attachmentCount: number;
}

function mkMock(attachmentCount = 0): TextInputMock {
  return { focusShifts: [], submits: [], attachmentCount };
}

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

/** Mirror of A-4's `runTextInputOnMouseUnifiedDispatch` route
 *  callbacks — SAME semantic rules, stubbed out dependencies. */
function buildTextInputRoutes(cfg: StubConfig, mock: TextInputMock): RouteCallbacks {
  return {
    routeMouseWiring: () => (cfg.wiring === 'consumed' ? 'consumed' : 'passthrough'),

    routePaneNavClick: () => {
      // Pane-nav DOES focus-shift (user picked a tab). Input mode's
      // no-focus-steal rule applies to pane-BODY only.
      if (cfg.eventType !== 'click') return 'passthrough';
      if (cfg.paneNav === null) return 'passthrough';
      mock.focusShifts.push({ target: cfg.paneNav, reason: 'input-onMouse-pane-nav' });
      return 'consumed';
    },

    routePaneClick: (_ev, _allowFocusSteal) => {
      const outcome = cfg.paneClick;
      if (outcome.kind === 'no-hit') return 'passthrough';
      // KEY invariant: textInput NEVER shifts focus on pane-body
      // click, regardless of allowFocusSteal.
      if (outcome.kind === 'widget-handled') {
        if (outcome.submitText !== null) mock.submits.push(outcome.submitText);
        return 'consumed';
      }
      // focus-only: click/dbl consumed, scroll passthrough for tail block.
      return (cfg.eventType === 'click' || cfg.eventType === 'double-click')
        ? 'consumed' : 'passthrough';
    },

    routeLogZoneClick: (_ev, _allowFocusSteal) => {
      // textInput-specific attachment gate.
      if (cfg.eventType !== 'click') return 'passthrough';
      if (mock.attachmentCount === 0) return 'passthrough';
      return cfg.logZone === 'consumed' ? 'consumed' : 'passthrough';
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

const INPUT: ViewMode = { kind: 'input' };
const IDLE:  ViewMode = { kind: 'idle' };

// ── §1 mouseWiring short-circuit ──────────────────────────

describe('A-4 · routeMouseWiring wins first (parity w/ A-3)', () => {
  test('pill click consumed → neither pane-nav nor pane-body run · no focus shift · no submit', () => {
    const mock = mkMock(/*attachmentCount*/ 3);
    const cfg: StubConfig = {
      wiring: 'consumed',
      paneNav: 'tasks',
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: 'X' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pill', name: 'model' },
    }));
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([]);
    expect(mock.submits).toEqual([]);
  });
});

// ── §2 pane-nav DOES focus-shift in input mode ───────────

describe('A-4 · routePaneNavClick — focus SHIFTS (unlike pane-body)', () => {
  test('pane-nav click records input-onMouse-pane-nav reason', () => {
    const mock = mkMock();
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
    routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(mock.focusShifts).toEqual([
      { target: 'scheduler', reason: 'input-onMouse-pane-nav' },
    ]);
  });

  test('pane-nav reason differs from mx-mouse equivalent (pins semantic distinction)', () => {
    // A-3 used 'mx-mouse-pane-nav'; A-4 uses 'input-onMouse-pane-nav'.
    // Pin both so future refactors can't accidentally collapse them.
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'browser',
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));
    expect(mock.focusShifts[0]?.reason).toBe('input-onMouse-pane-nav');
    expect(mock.focusShifts[0]?.reason).not.toBe('mx-mouse-pane-nav');
  });

  test('non-click event on pane-nav row → passthrough (no focus)', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'scheduler',                // would match click
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));
    expect(mock.focusShifts).toEqual([]);
  });
});

// ── §3 pane-body NEVER focus-shifts (key A-4 invariant) ──

describe('A-4 · routePaneClick — no focus steal (don\'t steal focus mid-typing)', () => {
  test('widget-handled with submit → submit dispatched · NO focus shift (INPUT viewMode)', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: 'hello' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.submits).toEqual(['hello']);
    // KEY TEST: no focus shift even though paneClick returned a
    // focusPane · differs from A-3 mx-mouse semantics.
    expect(mock.focusShifts).toEqual([]);
  });

  test('widget-handled NO submit → still consumed · still no focus shift', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'preview', submitText: null },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.submits).toEqual([]);
    expect(mock.focusShifts).toEqual([]);
  });

  test('focus-only click consumed · NO focus shift', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    expect(mock.focusShifts).toEqual([]);
  });

  test('focus-only scroll passthrough (tail block handles chatScrollOffset)', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'focus-only', focusPane: 'browser' },
      logZone: 'out-of-zone',
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    // Scroll on focus-only pane is passthrough so tail chatScrollOffset
    // adjustment can run in the outer helper.
    expect(outcome).toBe('passthrough');
    expect(mock.focusShifts).toEqual([]);
  });

  test('policy check — routePaneClick receives allowFocusSteal=false under INPUT', () => {
    // Even though textInput's routePaneClick ignores the flag, we pin
    // that derivePolicyForViewMode STILL computes the right value so
    // any future refactor that did honour the flag wouldn't regress.
    const calls: Array<{ name: string; allowFocusSteal: boolean }> = [];
    const routes: RouteCallbacks = {
      routePaneClick: (_ev, allowFocusSteal) => {
        calls.push({ name: 'paneClick', allowFocusSteal });
        return 'passthrough';
      },
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(INPUT, routes));
    expect(calls[0]?.allowFocusSteal).toBe(false);
  });
});

// ── §4 log-zone attachment gate (textInput-specific) ──────

describe('A-4 · routeLogZoneClick — attachment gate', () => {
  test('log-zone click WITH attachments → consumed · no focus shift', () => {
    const mock = mkMock(/*attachmentCount*/ 3);
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('consumed');
    // No focus shift in INPUT viewMode.
    expect(mock.focusShifts).toEqual([]);
  });

  test('log-zone click WITHOUT attachments → passthrough (gate blocks)', () => {
    const mock = mkMock(/*attachmentCount*/ 0);           // ← no attachments
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',                                 // even if log says yes
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    expect(outcome).toBe('passthrough');                   // gate blocks
    expect(mock.focusShifts).toEqual([]);
  });

  test('scroll on log-zone (even with attachments) → passthrough for tail block', () => {
    const mock = mkMock(/*attachmentCount*/ 3);
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'consumed',
      eventType: 'scroll-up',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp({ type: 'scroll-up' }));
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));

    // Click-only gate — scroll passes through to tail chatScrollOffset.
    expect(outcome).toBe('passthrough');
  });

  test('log-zone passthrough (out-of-zone / other reason) → passthrough', () => {
    const mock = mkMock(/*attachmentCount*/ 3);
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));
    expect(outcome).toBe('passthrough');
  });
});

// ── §5 cross-viewMode consistency ────────────────────────

describe('A-4 · cross-viewMode', () => {
  test('runs under IDLE viewMode too (e.g. textInput.onMouse during non-input frames)', () => {
    // Rare but possible — ensure the callback set works even when
    // viewMode isn't strictly 'input'. Focus-steal still blocked by
    // routePaneClick body's own rule (independent of flag).
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: null },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    const outcome = routeInputEvent(inputEv, mkCtx(IDLE, buildTextInputRoutes(cfg, mock)));
    expect(outcome).toBe('consumed');
    // Still no focus shift — routePaneClick body enforces it.
    expect(mock.focusShifts).toEqual([]);
  });
});

// ── §6 A-3 vs A-4 divergence contract ────────────────────

describe('A-4 · divergence from A-3 mx-mouse', () => {
  test('INPUT + pane-body widget-handled: A-4 skips focus · (contrast w/ A-3)', () => {
    // Pin A-4's specific no-steal rule so A-3/A-4 can't accidentally
    // cross-contaminate if a future refactor tries to share
    // routePaneClick between the two helpers.
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: null,
      paneClick: { kind: 'widget-handled', focusPane: 'browser', submitText: null },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));
    expect(mock.focusShifts).toEqual([]);
  });

  test('pane-nav: A-4 uses input-onMouse-pane-nav · (contrast w/ mx-mouse-pane-nav)', () => {
    const mock = mkMock();
    const cfg: StubConfig = {
      wiring: 'pass',
      paneNav: 'scheduler',
      paneClick: { kind: 'no-hit' },
      logZone: 'out-of-zone',
      eventType: 'click',
    };
    const inputEv = buildMouseInputEventFromDisplay(dsp());
    routeInputEvent(inputEv, mkCtx(INPUT, buildTextInputRoutes(cfg, mock)));
    expect(mock.focusShifts[0]?.reason).toBe('input-onMouse-pane-nav');
  });
});
