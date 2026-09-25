// Heatmap widget tests — Phase 4 P2c.

import { describe, expect, test } from 'bun:test';
import heatmapWidget, { type HeatmapState } from '../widgets/heatmap/widget.js';
import { canvasFactory } from '../src/canvas/index.js';
import { stripAnsi } from '../src/tui.js';

function ctxOf(overrides: { width?: number; height?: number; focused?: boolean } = {}): any {
  return {
    widgetId: 'wd-heat',
    widgetType: 'heatmap',
    character: 'Heat',
    width: overrides.width ?? 20,
    height: overrides.height ?? 6,
    focused: overrides.focused ?? true,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
    canvas: canvasFactory,
  };
}

describe('heatmap initialState', () => {
  test('defaults', () => {
    const s = heatmapWidget.initialState();
    expect(s.rows).toEqual([]);
    expect(s.cursorRow).toBe(0);
    expect(s.cursorCol).toBe(0);
    expect(s.min).toBe(null);
    expect(s.max).toBe(null);
  });

  test('accepts config rows + unit', () => {
    const s = heatmapWidget.initialState({
      rows: [[1, 2], [3, 4]],
      unit: '%',
    });
    expect(s.rows).toEqual([[1, 2], [3, 4]]);
    expect(s.unit).toBe('%');
  });
});

describe('heatmap render', () => {
  test('empty rows show empty-heatmap hint', () => {
    const state = heatmapWidget.initialState();
    const out = heatmapWidget.render(state, ctxOf({ height: 4 }), 'Heat');
    const plain = out.map(stripAnsi).join('\n');
    expect(out).toHaveLength(4);
    expect(plain).toContain('empty heatmap');
  });

  test('renders output rows equal to ctx.height', () => {
    const state = heatmapWidget.initialState({
      rows: [
        [0, 50, 100, 150, 200],
        [10, 60, 110, 160, 210],
        [20, 70, 120, 170, 220],
      ],
    });
    const out = heatmapWidget.render(state, ctxOf({ height: 8 }), 'Heat');
    expect(out).toHaveLength(8);
  });

  test('overlay label shows range + cursor value', () => {
    const state: HeatmapState = heatmapWidget.initialState({
      rows: [[10, 20], [30, 40]],
      unit: '%',
    });
    state.cursorRow = 1;
    state.cursorCol = 1;
    state.cursor = 3;
    const out = heatmapWidget.render(state, ctxOf({ height: 5 }), 'Heat');
    const plain = out.map(stripAnsi).join('\n');
    // Overlay is on line 1
    expect(plain).toContain('(1,1)');
    expect(plain).toContain('40');
  });

  test('bad dimensions → empty lines', () => {
    const state = heatmapWidget.initialState({ rows: [[1, 2]] });
    expect(heatmapWidget.render(state, ctxOf({ height: 0 }), 'Heat')).toEqual([]);
    expect(heatmapWidget.render(state, ctxOf({ width: 0 }), 'Heat')).toEqual([]);
  });

  test('no canvas → graceful fallback', () => {
    const state = heatmapWidget.initialState({ rows: [[1, 2], [3, 4]] });
    const ctx = ctxOf({ height: 4 });
    ctx.canvas = undefined;
    const out = heatmapWidget.render(state, ctx, 'Heat');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('dithered canvas unavailable');
  });
});

describe('heatmap Cursorable behavior', () => {
  test('cursor moves over flat cell count', () => {
    const state: HeatmapState = heatmapWidget.initialState({
      rows: [[1, 2, 3], [4, 5, 6]],
    });
    const cursor = heatmapWidget.behaviors!.find((b) => b.name === 'cursorable')!;
    cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(1);
    cursor.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(5);
    heatmapWidget.render(state, ctxOf(), 'Heat');
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(2);
  });

  test('empty rows → no movement', () => {
    const state = heatmapWidget.initialState();
    const cursor = heatmapWidget.behaviors!.find((b) => b.name === 'cursorable')!;
    cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(0);
  });
});

describe('heatmap snapshot', () => {
  test('reports dims + stats + 3×3 sample', () => {
    const state = heatmapWidget.initialState({
      rows: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
      ],
    });
    const snap = heatmapWidget.snapshot!(state, ctxOf()) as Record<string, any>;
    expect(snap.rows).toBe(4);
    expect(snap.cols).toBe(4);
    expect(snap.cells).toBe(16);
    expect(snap.min).toBe(1);
    expect(snap.max).toBe(16);
    expect(snap.avg).toBe(8.5);
    expect(snap.sample3x3).toEqual([[1, 2, 3], [5, 6, 7], [9, 10, 11]]);
  });

  test('empty rows → null stats', () => {
    const state = heatmapWidget.initialState();
    const snap = heatmapWidget.snapshot!(state, ctxOf()) as Record<string, any>;
    expect(snap.rows).toBe(0);
    expect(snap.min).toBe(null);
    expect(snap.max).toBe(null);
    expect(snap.avg).toBe(null);
  });
});

describe('heatmap describe', () => {
  test('row 0 is title', () => {
    const state = heatmapWidget.initialState({ rows: [[1, 2]] });
    expect(heatmapWidget.describe!(state, ctxOf(), 0, 0)).toContain('title row');
  });

  test('body row/col → cell value', () => {
    const state = heatmapWidget.initialState({
      rows: [[10, 20], [30, 40]],
    });
    const desc = heatmapWidget.describe!(state, ctxOf({ width: 20, height: 5 }), 1, 0);
    expect(desc).toContain('cell (0, 0)');
    expect(desc).toContain('10');
  });

  test('empty rows → explicit empty', () => {
    const state = heatmapWidget.initialState();
    expect(heatmapWidget.describe!(state, ctxOf(), 1, 0)).toContain('empty');
  });
});

describe('heatmap onMouse', () => {
  test('click maps body hit to cursor cell', () => {
    const state = heatmapWidget.initialState({
      rows: [[10, 20], [30, 40]],
    });
    heatmapWidget.render(state, ctxOf({ width: 20, height: 5 }), 'Heat');

    const action = heatmapWidget.onMouse!(
      { type: 'click', row: 3, col: 15 } as never,
      state,
      ctxOf({ width: 20, height: 5 }),
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(1);
    expect(state.cursor).toBe(3);
  });

  test('title-row click is ignored and first body row starts at row 1', () => {
    const state = heatmapWidget.initialState({
      rows: [[1, 2], [3, 4]],
    });
    const ctx = ctxOf({ width: 20, height: 4 });
    heatmapWidget.render(state, ctx, 'Heat');

    const action = heatmapWidget.onMouse!(
      { type: 'click', row: 1, col: 12 } as never,
      state,
      ctx,
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(1);
    expect(state.cursor).toBe(1);
  });

  test('title-row click is ignored when title is present', () => {
    const state = heatmapWidget.initialState({
      rows: [[1, 2], [3, 4]],
    });
    const ctx = ctxOf({ width: 20, height: 5 });
    heatmapWidget.render(state, ctx, 'Heat');

    expect(heatmapWidget.onMouse!({ type: 'click', row: 0, col: 5 } as never, state, ctx))
      .toEqual({ type: 'none' });
    expect(state.cursor).toBe(0);
  });
});
