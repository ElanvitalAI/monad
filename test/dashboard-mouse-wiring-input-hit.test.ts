// DS-3a preflight · dashboard-mouse-wiring classification of the
// `{kind:'input', inputId}` HitTarget variant
// (PLAN-hittarget-input-kind-extension.md §4.1).
//
// Order of classification: status-bar > input > pane > modal
// forwarding (the last happens inside a separate branch). This file
// pins the "input runs after status but before pane" invariant so
// a future refactor can't accidentally let a pane swallow the fixed
// chat-input row.

import { describe, expect, test } from 'bun:test';
import { createDashboardMouseWiring } from '../src/dashboard/input/mouse-wiring.js';
import type { DisplayMouseEvent, HitTarget } from '../src/display/types.js';

function makeWiring(opts: {
  getInputHitTarget?: (row: number, col: number) => { kind: 'input'; inputId: string } | null;
  getPaneHitTarget?: (row: number, col: number) => HitTarget | null;
}): ReturnType<typeof createDashboardMouseWiring> {
  return createDashboardMouseWiring({
    termSize: () => ({ rows: 30, cols: 120 }),
    getRotation: () => [],
    setActiveModel: () => {},
    getRecentWds: () => [],
    setSessionWd: () => {},
    pushModalSurface: () => ({ dispose: () => {} }),
    redraw: () => {},
    ...opts,
  });
}

function ev(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('DS-3a preflight · getInputHitTarget classification', () => {
  test('input hit attaches {kind:input, inputId} onto ev.hitTarget', () => {
    const wiring = makeWiring({
      getInputHitTarget: (row, _col) =>
        row === 28 ? { kind: 'input', inputId: 'chat-main' } : null,
    });
    // `handleMouse` mutates ev.hitTarget in place — read it back after.
    const outEvent: DisplayMouseEvent = ev('click', 28, 40);
    wiring.handleMouse(outEvent);
    expect(outEvent.hitTarget).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('input classifier skipped when callback returns null', () => {
    const wiring = makeWiring({
      getInputHitTarget: () => null,
      getPaneHitTarget: (row, col) =>
        ({ kind: 'pane-body', paneId: 'browser' }) as HitTarget,
    });
    const outEvent: DisplayMouseEvent = ev('click', 15, 40);
    wiring.handleMouse(outEvent);
    expect(outEvent.hitTarget).toEqual({ kind: 'pane-body', paneId: 'browser' });
  });

  test('input classifier overrides pane classifier for same row/col', () => {
    // Input wins over pane — chat composer row is fixed position
    // beneath status bar and pane region may overlap.
    const wiring = makeWiring({
      getInputHitTarget: () => ({ kind: 'input', inputId: 'chat-main' }),
      getPaneHitTarget: () => ({ kind: 'pane-body', paneId: 'browser' }),
    });
    const outEvent: DisplayMouseEvent = ev('click', 28, 40);
    wiring.handleMouse(outEvent);
    expect(outEvent.hitTarget).toEqual({ kind: 'input', inputId: 'chat-main' });
  });

  test('missing both callbacks — no hitTarget attached (backward compat)', () => {
    const wiring = makeWiring({});
    const outEvent: DisplayMouseEvent = ev('click', 15, 40);
    wiring.handleMouse(outEvent);
    expect(outEvent.hitTarget).toBeUndefined();
  });

  test('input callback throw isolated — falls back to pane branch', () => {
    const wiring = makeWiring({
      getInputHitTarget: () => {
        throw new Error('synthetic host failure');
      },
      getPaneHitTarget: () => ({ kind: 'pane-body', paneId: 'browser' }),
    });
    const outEvent: DisplayMouseEvent = ev('click', 15, 40);
    expect(() => wiring.handleMouse(outEvent)).not.toThrow();
    expect(outEvent.hitTarget).toEqual({ kind: 'pane-body', paneId: 'browser' });
  });
});
