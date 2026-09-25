import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

// V3 smoke — the dashboard's onRender lambda must forward
// request.force to draw(). This test models that wiring: we use the
// same callback shape the dashboard uses (onRender → draw({force}))
// and assert a popModal path sets force=true on the downstream call.

function modal(id: string): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
    bounds: { row: 3, col: 3, width: 20, height: 5 },
    paint: () => '',
  };
}

describe('V3 — coordinator.request.force reaches draw()', () => {
  test('popModal propagates force=true through onRender → draw', () => {
    const drawCalls: Array<{ force: boolean }> = [];
    const scheduled: Array<() => void> = [];

    const draw = ({ force = false }: { force?: boolean } = {}) => {
      drawCalls.push({ force });
    };

    const coord = new DisplayCoordinator({
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      termSize: () => ({ rows: 40, cols: 120 }),
      invalidateRow: () => {},
      onRender: (request) => draw({ force: request.force }),
    });

    const { dispose } = coord.pushModal(modal('m'));
    scheduled.shift()!();
    // Mount doesn't force a repaint — pushModal's markDirty + setFocus
    // already drives a routine redraw, and the overlay paints on
    // absolute coords. Close is the path that needs force to wipe
    // residual pixels.
    drawCalls.length = 0;
    dispose();
    scheduled.shift()!();
    expect(drawCalls[0]!.force).toBe(true); // close forced
  });

  test('routine render (no force) keeps force=false', () => {
    const drawCalls: Array<{ force: boolean }> = [];
    const scheduled: Array<() => void> = [];

    const draw = ({ force = false }: { force?: boolean } = {}) => {
      drawCalls.push({ force });
    };

    const coord = new DisplayCoordinator({
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      termSize: () => ({ rows: 40, cols: 120 }),
      invalidateRow: () => {},
      onRender: (request) => draw({ force: request.force }),
    });

    coord.publish({ type: 'requestRender', region: 'pane:log' });
    scheduled.shift()!();
    expect(drawCalls[0]!.force).toBe(false);
  });

  test('afterRender hook receives the same request.force', () => {
    const drawForce: boolean[] = [];
    const afterForce: boolean[] = [];
    const scheduled: Array<() => void> = [];

    const coord = new DisplayCoordinator({
      schedule: (fn) => { scheduled.push(fn); return 0 as any; },
      termSize: () => ({ rows: 40, cols: 120 }),
      invalidateRow: () => {},
      onRender: (request) => drawForce.push(request.force),
      hooks: {
        afterRender: (request) => afterForce.push(request.force),
      },
    });

    coord.pushModal(modal('m'));
    scheduled.shift()!();
    // Mount flush: routine, not forced.
    expect(drawForce).toEqual([false]);
    expect(afterForce).toEqual([false]);

    coord.popModal('m');
    scheduled.shift()!();
    // Close flush: forced.
    expect(drawForce).toEqual([false, true]);
    expect(afterForce).toEqual([false, true]);
  });
});
