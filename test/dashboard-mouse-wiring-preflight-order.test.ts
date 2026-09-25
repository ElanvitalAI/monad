import { describe, expect, test } from 'bun:test';
import { createDashboardMouseWiring } from '../src/dashboard/input/mouse-wiring.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

function makeWiring(opts: {
  getInputHitTarget?: (row: number, col: number) => { kind: 'input'; inputId: string } | null;
  getModalHitTarget?: (row: number, col: number) =>
    | { kind: 'modal-body'; modalId: string; itemIndex?: number }
    | { kind: 'modal-button'; modalId: string; buttonId: string }
    | null;
  getPaneHitTarget?: (row: number, col: number) =>
    | { kind: 'pane-body'; paneId: string }
    | { kind: 'pane-title'; paneId: string }
    | { kind: 'pane-nav-tab'; paneId: string }
    | null;
}) {
  const wiring = createDashboardMouseWiring({
    termSize: () => ({ rows: 24, cols: 120 }),
    getRotation: () => [],
    setActiveModel: () => {},
    getRecentWds: () => [],
    setSessionWd: () => {},
    pushModalSurface: () => ({ dispose: () => {} }),
    redraw: () => {},
    ...opts,
  });
  wiring.setStatusRow(23);
  return wiring;
}

describe('R8d · dashboard-mouse-wiring preflight order', () => {
  test('input classifier wins before modal and pane classifiers', () => {
    const wiring = makeWiring({
      getInputHitTarget: () => ({ kind: 'input', inputId: 'chat-main' }),
      getModalHitTarget: () => ({ kind: 'modal-body', modalId: 'approval-1' }),
      getPaneHitTarget: () => ({ kind: 'pane-body', paneId: 'browser' }),
    });
    const ev = mouse('right-click', 10, 20);
    wiring.handleMouse(ev);
    expect(ev.hitTarget).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('modal classifier wins before pane classifier when input misses', () => {
    const wiring = makeWiring({
      getInputHitTarget: () => null,
      getModalHitTarget: () => ({ kind: 'modal-body', modalId: 'approval-1' }),
      getPaneHitTarget: () => ({ kind: 'pane-body', paneId: 'browser' }),
    });
    const ev = mouse('right-click', 10, 20);
    wiring.handleMouse(ev);
    expect(ev.hitTarget).toEqual({ kind: 'modal-body', modalId: 'approval-1' });
  });

  test('pane classifier runs only after earlier preflight classifiers miss', () => {
    const wiring = makeWiring({
      getInputHitTarget: () => null,
      getModalHitTarget: () => null,
      getPaneHitTarget: () => ({ kind: 'pane-title', paneId: 'browser' }),
    });
    const ev = mouse('right-click', 10, 20);
    wiring.handleMouse(ev);
    expect(ev.hitTarget).toEqual({ kind: 'pane-title', paneId: 'browser' });
  });
});
