// IDX-F5d Phase 2 — widget-rail hover dispatch.
//
// End-to-end: a pane-body hit with a describeHit-aware widget +
// motion mouse event should flow through createDashboardMouseWiring
// → HoverTracker → dispatchHoverToWidget → widget.onHover.
//
// These tests exercise just the wiring + tracker layer (no dashboard
// import). The widget-host integration lands in a separate test.

import { describe, expect, test } from 'bun:test';

import {
  createDashboardMouseWiring,
  type DashboardMouseWiringDeps,
} from '../src/dashboard/input/mouse-wiring.js';
import { createHoverTracker } from '../src/ui/hover-tracker.js';
import type { DisplayMouseEvent, HitTarget } from '../src/display/types.js';

function makeDeps(extras: Partial<DashboardMouseWiringDeps> = {}): {
  deps: DashboardMouseWiringDeps;
  dispatchedHover: Array<{ paneId: string; event: unknown }>;
} {
  const dispatchedHover: Array<{ paneId: string; event: unknown }> = [];
  // Tracker with a synchronous fake timer so stable-hover fires
  // deterministically when we drive the dispatch loop.
  const tracker = createHoverTracker({
    stableDelayMs: 10,
    setTimer: (fn, _ms) => { /* never fire for these tests */ return 0; },
    clearTimer: () => {},
  });
  const deps: DashboardMouseWiringDeps = {
    termSize: () => ({ rows: 30, cols: 120 }),
    getRotation: () => [],
    setActiveModel: () => {},
    getRecentWds: () => [],
    setSessionWd: () => {},
    pushModalSurface: () => ({ dispose: () => {} }) as unknown as ReturnType<Required<DashboardMouseWiringDeps>['pushModalSurface']>,
    redraw: () => {},
    hoverTracker: tracker,
    dispatchHoverToWidget: (paneId, event) => {
      dispatchedHover.push({ paneId, event });
    },
    ...extras,
  };
  return { deps, dispatchedHover };
}

function paneBodyHit(paneId: string, itemIndex?: number): HitTarget {
  return itemIndex === undefined
    ? { kind: 'pane-body', paneId, widgetInstanceId: paneId }
    : {
        kind: 'pane-body',
        paneId,
        widgetInstanceId: paneId,
        hit: { kind: 'list-row', itemIndex },
      };
}

function motionEv(row: number, col: number, hitTarget?: HitTarget): DisplayMouseEvent {
  return { type: 'motion', row, col, ...(hitTarget ? { hitTarget } : {}) };
}

describe('widget-rail hover dispatch', () => {
  test('pane-body motion with hit fires hover-enter on widget', () => {
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-browser', 3)));
    // hover-enter should have fired (no previous target).
    const enter = dispatchedHover.find(d => (d.event as { kind: string }).kind === 'hover-enter');
    expect(enter).toBeDefined();
    expect(enter!.paneId).toBe('wd-browser');
    expect((enter!.event as { hit: { kind: string; itemIndex: number } }).hit).toEqual({
      kind: 'list-row',
      itemIndex: 3,
    });
    wiring.dispose();
  });

  test('row change fires leave(old) + enter(new) pair', () => {
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-browser', 2)));
    dispatchedHover.length = 0; // reset after initial enter
    wiring.handleMouse(motionEv(7, 10, paneBodyHit('wd-browser', 4)));
    const kinds = dispatchedHover.map(d => (d.event as { kind: string }).kind);
    expect(kinds).toContain('hover-leave');
    expect(kinds).toContain('hover-enter');
    wiring.dispose();
  });

  test('pane-body without refinement → no widget dispatch', () => {
    // Widget hasn't implemented describeHit (or landed on title row),
    // so hitTarget.hit is undefined. The tracker still sees the
    // pane-body target but the bridge subscribes only when `t.hit` is
    // present (can't synthesize a WidgetHoverEvent without it).
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-browser')));
    expect(dispatchedHover.length).toBe(0);
    wiring.dispose();
  });

  test('pointer leaves pane → hover-leave fires with last hit', () => {
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-browser', 1)));
    dispatchedHover.length = 0;
    // Pointer moves off the pane entirely (no hitTarget).
    wiring.handleMouse(motionEv(100, 100));
    const leave = dispatchedHover.find(d => (d.event as { kind: string }).kind === 'hover-leave');
    expect(leave).toBeDefined();
    expect((leave!.event as { hit: { itemIndex: number } }).hit.itemIndex).toBe(1);
    wiring.dispose();
  });

  test('different paneId than dispatched still routes to correct widget', () => {
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-scheduler-ready', 0)));
    const enter = dispatchedHover.find(d => (d.event as { kind: string }).kind === 'hover-enter');
    expect(enter?.paneId).toBe('wd-scheduler-ready');
    wiring.dispose();
  });

  test('repeated same-target motion fires hover-over, not re-enter', () => {
    const { deps, dispatchedHover } = makeDeps();
    const wiring = createDashboardMouseWiring(deps);
    wiring.handleMouse(motionEv(5, 10, paneBodyHit('wd-browser', 2)));
    const enterCount1 = dispatchedHover.filter(d => (d.event as { kind: string }).kind === 'hover-enter').length;
    wiring.handleMouse(motionEv(5, 11, paneBodyHit('wd-browser', 2)));
    wiring.handleMouse(motionEv(5, 12, paneBodyHit('wd-browser', 2)));
    const enterCount2 = dispatchedHover.filter(d => (d.event as { kind: string }).kind === 'hover-enter').length;
    expect(enterCount2).toBe(enterCount1); // no repeat enter
    const overCount = dispatchedHover.filter(d => (d.event as { kind: string }).kind === 'hover-over').length;
    expect(overCount).toBeGreaterThan(0);
    wiring.dispose();
  });
});
