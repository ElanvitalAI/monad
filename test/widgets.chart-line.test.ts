// ── Chart-line widget tests ──

import { describe, test, expect } from 'bun:test';
import chartLine from '../widgets/chart-line/widget.js';
import type { RenderCtx } from '../src/widgets/types.js';

const ctx = (overrides: Partial<RenderCtx> = {}): RenderCtx => ({
  width: 30, height: 10, focused: true, ...overrides,
});

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

describe('chart-line widget', () => {
  test('initialState copies series + unit from config', () => {
    const s = chartLine.initialState({ series: [1, 2, 3], unit: '$' });
    expect(s.series).toEqual([1, 2, 3]);
    expect(s.unit).toBe('$');
  });

  test('empty series renders placeholder without crashing', () => {
    const state = chartLine.initialState();
    const out = chartLine.render(state, ctx(), 'Price');
    expect(out.length).toBe(10);
    expect(stripAnsi(out.join(''))).toContain('no data');
  });

  test('single-point series renders one dot', () => {
    const state = chartLine.initialState({ series: [5] });
    const out = chartLine.render(state, ctx(), 'P');
    const body = stripAnsi(out.slice(1).join(''));
    expect(body).toContain('\u25CF');
  });

  test('multi-point series places dots across columns', () => {
    const state = chartLine.initialState({ series: [1, 5, 3, 8, 2] });
    const out = chartLine.render(state, ctx({ width: 30, height: 8 }), 'P');
    const dotCount = (stripAnsi(out.slice(1).join('')).match(/\u25CF/g) || []).length;
    expect(dotCount).toBe(5);
  });

  test('min + max labels appear on first and last body rows', () => {
    const state = chartLine.initialState({ series: [10, 50, 30], unit: '$' });
    const out = chartLine.render(state, ctx(), 'P');
    const body = out.slice(1).map(stripAnsi);
    expect(body[0]).toContain('$50');         // max
    expect(body[body.length - 1]).toContain('$10');  // min
  });

  test('long series is right-truncated to available width', () => {
    const big = Array.from({ length: 100 }, (_, i) => i);
    const state = chartLine.initialState({ series: big });
    const out = chartLine.render(state, ctx({ width: 30 }), 'P');
    // Chart width = 30 - labelW(7) - 1 = 22. Samples kept = last 22.
    const dotCount = (stripAnsi(out.slice(1).join('')).match(/\u25CF/g) || []).length;
    expect(dotCount).toBeLessThanOrEqual(22);
  });

  test('tiny height returns just the title', () => {
    const state = chartLine.initialState({ series: [1, 2, 3] });
    const out = chartLine.render(state, ctx({ height: 1 }), 'P');
    expect(out).toHaveLength(1);
  });

  test('onMouse click selects a visible sample and shows badge', () => {
    const state = chartLine.initialState({ series: [10, 20, 30, 40, 50] });
    const action = chartLine.onMouse!(
      { type: 'click', row: 2, col: 9 } as never,
      state,
      ctx({ width: 30, height: 8 }),
    );
    expect(action).toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(2);

    const out = chartLine.render(state, ctx({ width: 30, height: 8 }), 'P');
    expect(stripAnsi(out[1]!)).toContain('idx 2');
    expect(stripAnsi(out[1]!)).toContain('30');
  });

  test('title-row is reserved and first body row starts at row 1', () => {
    const state = chartLine.initialState({ series: [10, 20, 30, 40] });
    chartLine.render(state, ctx({ width: 24, height: 6 } as never), 'P');
    const action = chartLine.onMouse!(
      { type: 'click', row: 1, col: 8 } as never,
      state,
      ctx({ width: 24, height: 6 } as never),
    );
    expect(action).toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(1);
  });

  test('scroll wheel nudges selected sample', () => {
    const state = chartLine.initialState({ series: [10, 20, 30, 40] });
    expect(chartLine.onMouse!({ type: 'scroll-up', row: 1, col: 0 } as never, state, ctx()))
      .toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(2);
    expect(chartLine.onMouse!({ type: 'scroll-down', row: 1, col: 0 } as never, state, ctx()))
      .toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(3);
  });
});
