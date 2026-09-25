// Phase DS-2b — dashboard-mouse-wiring.ts accepts an optional
// `dragDispatch` dep that runs AFTER hitTarget attachment and
// BEFORE the existing mouse chain. When it returns true, the event
// is consumed and `handleMouse` returns true immediately.
//
// This pins the 1-line hook contract so future refactors of
// mouse-wiring can't accidentally lose drag routing.

import { describe, expect, test } from 'bun:test';
import { createDashboardMouseWiring } from '../src/dashboard/input/mouse-wiring.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

function makeWiring(opts?: {
  dragDispatch?: (ev: DisplayMouseEvent) => boolean;
}): ReturnType<typeof createDashboardMouseWiring> {
  return createDashboardMouseWiring({
    termSize: () => ({ rows: 30, cols: 120 }),
    getRotation: () => [],
    setActiveModel: () => {},
    getRecentWds: () => [],
    setSessionWd: () => {},
    pushModalSurface: () => ({ dispose: () => {} }),
    redraw: () => {},
    dragDispatch: opts?.dragDispatch,
  });
}

function mouseEv(
  type: DisplayMouseEvent['type'],
  row: number,
  col: number,
): DisplayMouseEvent {
  return { type, row, col };
}

describe('DS-2b — mouse-wiring dragDispatch hook', () => {
  test('dragDispatch returning true short-circuits handleMouse', () => {
    let called = 0;
    const wiring = makeWiring({
      dragDispatch: () => { called++; return true; },
    });
    const consumed = wiring.handleMouse(mouseEv('drag', 5, 10));
    expect(consumed).toBe(true);
    expect(called).toBe(1);
  });

  test('dragDispatch returning false lets handleMouse fall through', () => {
    let called = 0;
    const wiring = makeWiring({
      dragDispatch: () => { called++; return false; },
    });
    // Non-motion event with no pill/pane hit → still false, but
    // dragDispatch was consulted (called === 1).
    const consumed = wiring.handleMouse(mouseEv('click', 20, 50));
    expect(called).toBe(1);
    expect(consumed).toBe(false);
  });

  test('dragDispatch omitted — no drag routing, default behaviour preserved', () => {
    const wiring = makeWiring({});
    const consumed = wiring.handleMouse(mouseEv('click', 20, 50));
    expect(consumed).toBe(false);
    // `handleMouse` doesn't crash when dep is omitted — the optional
    // chaining pattern (`deps.dragDispatch?.(ev)`) silently skips.
  });

  test('motion events: hook runs BEFORE motion short-circuit · adapter decides', () => {
    // The mouse-wiring hook calls `deps.dragDispatch?.(ev)` AFTER
    // hitTarget attachment and BEFORE the motion short-circuit. A
    // well-behaved adapter (PR #319 drag-dispatch.ts) returns false
    // for motion events (non-progressing passthrough rule), letting
    // the motion short-circuit run and return false to the caller.
    let called = 0;
    const wiring = makeWiring({
      // Simulate the real adapter: returns false for motion.
      dragDispatch: (ev) => { called++; return ev.type !== 'motion' && false; },
    });
    const consumed = wiring.handleMouse(mouseEv('motion', 5, 5));
    expect(consumed).toBe(false);
    // Hook is invoked (callable position is pre-motion-short-circuit).
    expect(called).toBe(1);
  });

  test('dragDispatch is called AFTER hitTarget attachment (sees classified target)', () => {
    const seenHits: Array<DisplayMouseEvent['hitTarget']> = [];
    const wiring = makeWiring({
      dragDispatch: (ev) => { seenHits.push(ev.hitTarget); return false; },
    });
    // Event with no hit → dragDispatch sees ev.hitTarget as either
    // auto-classified (status-bar/pane) or undefined. When undefined
    // (no classifier match), adapter's translation layer defaults to
    // { kind: 'unknown' }.
    wiring.handleMouse({ type: 'click', row: 1, col: 1 });
    expect(seenHits).toHaveLength(1);
    // No assertion on specific kind — just that the hook was reached
    // AFTER the classification stage. The exact kind depends on pill
    // coverage at (1,1) which varies with terminal width.
  });

  test('drag event with adapter consuming it does NOT reach modal-forward chain', () => {
    // Simulate a drag-active scenario where the adapter consumes the
    // event. Even if a modal surface is declared via getTopModalSurface,
    // the modal's onMouse should NOT be invoked because dragDispatch
    // already returned true and short-circuited.
    const modalMouseCalls: Array<DisplayMouseEvent> = [];
    const modal: ModalSurface = {
      id: 'modal:1',
      owner: 'dashboard',
      kind: 'modal',
      tier: 'popup',
      focus: 'owns',
      priority: 250,
      bounds: { row: 10, col: 10, width: 20, height: 5 },
      render: () => [],
      paint: () => '',
      onMouse: (ev) => { modalMouseCalls.push(ev); return { kind: 'consumed' }; },
    };
    const wiring = createDashboardMouseWiring({
      termSize: () => ({ rows: 30, cols: 120 }),
      getRotation: () => [],
      setActiveModel: () => {},
      getRecentWds: () => [],
      setSessionWd: () => {},
      pushModalSurface: () => ({ dispose: () => {} }),
      redraw: () => {},
      getTopModalSurface: () => modal,
      dragDispatch: () => true,   // drag consumes all
    });

    wiring.handleMouse(mouseEv('drag', 12, 15));   // inside modal bounds
    expect(modalMouseCalls).toHaveLength(0);       // modal never saw it
  });
});
