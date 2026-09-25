import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ansi, invalidateRenderCacheRow, render, resetRenderCache, termSize,
} from '../src/tui.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { ModalSurface } from '../src/display/modal-stack.js';

// LC2 / V5 — behavioural fixtures for 6 modal shapes.
//
// Rather than pin literal ANSI byte streams (which drift with chalk
// and terminal envs), each fixture locks down the *observable shape*
// of a modal open/close cycle:
//   (1) body text is painted while open
//   (2) body text is gone after close
//   (3) force flag propagated on close
//   (4) eraseDown emitted on close (= full repaint)
//   (5) underlying line buffer rows emit again
//
// The 6 shapes match the real modal classes we run today: terminal,
// slash-picker, arg-picker, @-picker, approval, image. Each differs
// in bounds (big/small/wide/narrow/top/bottom) so the fixture covers
// region-invalidation across the full layout matrix.

interface Shape {
  name: string;
  bounds: ModalSurface['bounds'];
  body: string;
  /** Terminal row indices (1-indexed) this shape visually covers. */
  covers: number[];
}

const SHAPES: Shape[] = [
  {
    name: 'terminal',
    bounds: { row: 3, col: 4, width: 50, height: 14 },
    body: 'TERMINAL_SHELL_OUTPUT',
    covers: [3, 10, 16],
  },
  {
    name: 'slash-picker',
    bounds: { row: 14, col: 2, width: 40, height: 6 },
    body: 'SLASH_PICKER_ITEMS',
    covers: [14, 17, 19],
  },
  {
    name: 'arg-picker',
    bounds: { row: 16, col: 20, width: 24, height: 4 },
    body: 'ARG_COMPLETIONS',
    covers: [16, 18, 19],
  },
  {
    name: 'at-picker',
    bounds: { row: 15, col: 8, width: 28, height: 5 },
    body: 'AT_FILE_PICKER',
    covers: [15, 17, 19],
  },
  {
    name: 'approval',
    bounds: { row: 8, col: 15, width: 30, height: 5 },
    body: 'APPROVE_YES_NO',
    covers: [8, 10, 12],
  },
  {
    name: 'image',
    bounds: { row: 2, col: 2, width: 56, height: 16 },
    body: 'IMAGE_PREVIEW_SIXEL',
    covers: [2, 10, 17],
  },
];

function mkModal(s: Shape): ModalSurface {
  return {
    id: `modal-${s.name}`,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
    bounds: s.bounds,
    paint: () => `${ansi.moveTo(s.bounds.row, s.bounds.col)}${s.body}`,
  };
}

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

function buildRig() {
  const lines = Array.from({ length: 19 }, (_, i) => `line_${String(i + 1).padStart(2, '0')}_static_bg`);
  lines.push('inputbar_prompt_>');

  const scheduled: Array<() => void> = [];
  let lastForce = false;

  const coord = new DisplayCoordinator({
    frameMs: 16,
    schedule: (fn) => { scheduled.push(fn); return 0 as any; },
    termSize: () => termSize(),
    invalidateRow: (row0) => invalidateRenderCacheRow(row0),
    onRender: (req) => {
      lastForce = req.force;
      render(lines, { force: req.force });
    },
    writeOverlay: (s) => { process.stdout.write(s); },
  });
  return { coord, scheduled, getLastForce: () => lastForce, lines };
}

describe('LC2 modal-close fixture — 6 shapes', () => {
  for (const shape of SHAPES) {
    test(`[${shape.name}] close leaves no residual body + force=true + eraseDown`, () => {
      const { coord, scheduled, getLastForce } = buildRig();

      // Baseline paint.
      coord.publish({ type: 'requestRender', force: true });
      scheduled.shift()!();
      writes = [];

      // Open.
      coord.pushModal(mkModal(shape));
      scheduled.shift()!();
      const opened = writes.join('');
      expect(opened).toContain(shape.body);
      writes = [];

      // Close.
      coord.popModal(`modal-${shape.name}`);
      scheduled.shift()!();
      const closed = writes.join('');

      expect(getLastForce()).toBe(true);
      expect(closed).toContain(ansi.eraseDown);
      expect(closed).not.toContain(shape.body);
      // Spot-check that at least one row the modal covered emits the
      // static buffer line again (proof of repaint, not just overlay
      // removal).
      for (const r of shape.covers) {
        const zeroIdx = String(r).padStart(2, '0');
        expect(closed).toContain(`line_${zeroIdx}_static_bg`);
      }
    });
  }

  test('nested: two shapes open simultaneously, pop top leaves bottom visible', () => {
    const { coord, scheduled } = buildRig();
    const bottom = SHAPES.find(s => s.name === 'terminal')!;
    const top = SHAPES.find(s => s.name === 'approval')!;

    coord.publish({ type: 'requestRender', force: true });
    scheduled.shift()!();
    writes = [];

    coord.pushModal(mkModal(bottom));
    coord.pushModal(mkModal(top));
    while (scheduled.length) scheduled.shift()!();
    writes = [];

    // Pop only top.
    coord.popModal(`modal-${top.name}`);
    scheduled.shift()!();
    while (scheduled.length) scheduled.shift()!();
    const closed = writes.join('');

    // Top body gone, bottom body still re-painted by the overlay.
    expect(closed).not.toContain(top.body);
    expect(closed).toContain(bottom.body);
  });

  test('rapid open/close all 6 shapes in sequence — ends clean', () => {
    const { coord, scheduled } = buildRig();
    coord.publish({ type: 'requestRender', force: true });
    scheduled.shift()!();

    for (const s of SHAPES) {
      coord.pushModal(mkModal(s));
      scheduled.shift()!();
      coord.popModal(`modal-${s.name}`);
      while (scheduled.length) scheduled.shift()!();
    }

    expect(scheduled.length).toBe(0);
    // Force one more frame with no modals open — the isolated frame
    // must not contain any shape body.
    writes = [];
    coord.publish({ type: 'requestRender', force: true });
    scheduled.shift()!();
    const finalFrame = writes.join('');
    for (const s of SHAPES) {
      expect(finalFrame).not.toContain(s.body);
    }
  });
});
