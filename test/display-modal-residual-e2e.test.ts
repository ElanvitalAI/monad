import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ansi, invalidateRenderCacheRow, render, resetRenderCache, termSize,
} from '../src/tui.js';
import { DisplayCoordinator } from '../src/display/index.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

// V5 — end-to-end regression test for the modal-close residual bug.
//
// Wires a real DisplayCoordinator to the real tui.ts::render using the
// exact plumbing pattern the dashboard uses in production:
//   onRender: (request) => draw({ force: request.force })
//   draw({force}) → render(lines, { force, overlay })
//   termSize: () => termSize()
//   invalidateRow: (r) => invalidateRenderCacheRow(r)
//
// The static line buffer stays identical across frames. Without V1-V4
// wiring the render() diff would skip every row on the modal close and
// leave modal pixels resident. With the wiring the modal-covered rows
// are invalidated and repainted.

let writes: string[];
let originalWrite: typeof process.stdout.write;
let originalRows: number | undefined;
let originalColumns: number | undefined;

beforeEach(() => {
  writes = [];
  originalWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  originalRows = process.stdout.rows;
  originalColumns = process.stdout.columns;
  Object.defineProperty(process.stdout, 'rows', { value: 20, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true });
  process.stdout.write = ((chunk: any) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  resetRenderCache();
});

afterEach(() => {
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, 'rows', { value: originalRows, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: originalColumns, configurable: true });
  resetRenderCache();
});

function modal(id: string, bounds: ModalSurface['bounds'], body: string): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
    bounds,
    paint: () => `${ansi.moveTo(bounds.row, bounds.col)}${body}`,
  };
}

function makeDashboard() {
  // Static line buffer — the dashboard's "main content" that stays
  // unchanged across the modal-open / modal-close cycle.
  const lines = [
    'logpane line 1',
    'logpane line 2',
    'logpane line 3',
    'logpane line 4',
    'logpane line 5',
    'logpane line 6',
    'logpane line 7',
    'logpane line 8',
    'logpane line 9',
    'inputbar >',
  ];

  const scheduled: Array<() => void> = [];
  let lastForce = false;

  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    termSize: () => termSize(),
    invalidateRow: (row0) => invalidateRenderCacheRow(row0),
    onRender: (request) => {
      lastForce = request.force;
      render(lines, { force: request.force });
    },
    writeOverlay: (s) => { process.stdout.write(s); },
  });

  return { coord, scheduled, getLastForce: () => lastForce, lines };
}

describe('V5 — modal close does not leave residual pixels', () => {
  test('popModal invalidates modal rows and the next render repaints them', () => {
    const { coord, scheduled, getLastForce } = makeDashboard();

    // Frame 0 — baseline paint, modal not yet opened.
    coord.publish({ type: 'requestRender', force: true });
    scheduled.shift()!();
    writes = [];

    // Frame 1 — open modal on rows 3..6. It paints over the "logpane
    // line 3..6" rows.
    coord.pushModal(modal('m', { row: 3, col: 5, width: 30, height: 4 }, 'MODAL_BODY'));
    scheduled.shift()!();
    const frame1 = writes.join('');
    expect(frame1).toContain('MODAL_BODY');
    writes = [];

    // Frame 2 — close the modal. Lines buffer is unchanged; only the
    // V1-V4 wiring forces the modal-covered rows to be repainted.
    coord.popModal('m');
    scheduled.shift()!();
    const frame2 = writes.join('');

    // Coordinator propagated force to the render call.
    expect(getLastForce()).toBe(true);
    // Force-true triggers eraseDown; since full repaint happens, the
    // row contents under the modal are re-emitted too.
    expect(frame2).toContain(ansi.eraseDown);
    expect(frame2).toContain('logpane line 3');
    expect(frame2).toContain('logpane line 6');
    // Modal body is gone.
    expect(frame2).not.toContain('MODAL_BODY');
  });

  test('without force: if only row invalidation fired, covered rows still repaint', () => {
    // Simulate the scenario where force doesn't propagate (older build,
    // dashboard lambda not updated) but invalidateRow does. The frame-
    // cache sentinel alone is enough: tui.ts::render compares lines[i]
    // to '\x00dirty' and repaints the mismatch.
    const lines = ['a', 'b', 'c', 'd', 'e'];
    render(lines);
    writes = [];

    invalidateRenderCacheRow(2);        // forget row 'c'
    render(lines);                       // same lines[], no force

    const out = writes.join('');
    expect(out).not.toContain(ansi.eraseDown); // no full clear
    expect(out).toContain('c');                // but row 'c' emitted
    expect(out).not.toContain('a');             // untouched rows skipped
  });

  test('back-to-back modal open/close/open/close stays clean', () => {
    const { coord, scheduled } = makeDashboard();

    coord.publish({ type: 'requestRender', force: true });
    scheduled.shift()!();

    for (let i = 0; i < 3; i++) {
      coord.pushModal(modal('m', { row: 5, col: 3, width: 30, height: 4 }, `MODAL_${i}`));
      scheduled.shift()!();
      coord.popModal('m');
      scheduled.shift()!();
      // V4 schedules one follow-up frame per close.
      if (scheduled.length > 0) scheduled.shift()!();
    }

    // Final state: no pending frames, cache consistent (no throw).
    expect(scheduled.length).toBe(0);
  });
});
