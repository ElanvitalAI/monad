// Sparkline widget — Phase 4d consumer tests.

import { describe, expect, test } from 'bun:test';
import sparklineWidget from '../widgets/sparkline/widget.js';
import { canvasFactory } from '../src/canvas/index.js';
import { AnimationController } from '../src/animation/index.js';
import { stripAnsi } from '../src/tui.js';

function makeCtx(overrides: Partial<{ width: number; height: number; focused: boolean }> = {}): any {
  const state: any = {};
  const animator = new AnimationController();
  // Force animation to "fully revealed" so render() doesn't gate on progress.
  animator._setNowForTesting(() => 1_000_000);
  return {
    widgetId: 'wd-spark',
    widgetType: 'sparkline',
    character: 'Sparkline',
    width: overrides.width ?? 30,
    height: overrides.height ?? 6,
    focused: overrides.focused ?? true,
    state,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
    animate: {
      tween: (spec: any) => animator.tween(spec),
      progress: () => 1,     // fully revealed for deterministic tests
      isDone: () => true,
      hasActive: () => false,
      cancel: () => {},
    },
    canvas: canvasFactory,
  };
}

describe('sparkline initialState', () => {
  test('caps samples at capacity', () => {
    const state = sparklineWidget.initialState({
      samples: Array.from({ length: 500 }, (_, i) => i),
      capacity: 100,
    });
    expect(state.samples).toHaveLength(100);
    expect(state.samples[0]).toBe(400);
    expect(state.samples[99]).toBe(499);
  });

  test('defaults capacity to 200 and color to accent', () => {
    const state = sparklineWidget.initialState();
    expect(state.capacity).toBe(200);
    expect(state.color).toBe('accent');
    expect(state.samples).toEqual([]);
  });

  test('honours min/max/unit overrides', () => {
    const state = sparklineWidget.initialState({ min: 0, max: 100, unit: '%' });
    expect(state.min).toBe(0);
    expect(state.max).toBe(100);
    expect(state.unit).toBe('%');
  });
});

describe('sparkline render', () => {
  test('empty state shows a waiting-for-data hint', () => {
    const state = sparklineWidget.initialState();
    const out = sparklineWidget.render(state, makeCtx({ height: 5 }), 'Sparkline');
    const plain = out.map(stripAnsi).join('\n');
    expect(out).toHaveLength(5);
    expect(plain).toContain('Sparkline');
    expect(plain).toContain('waiting for data');
  });

  test('single sample still shows waiting (needs ≥ 2 for a line)', () => {
    const state = sparklineWidget.initialState({ samples: [1] });
    const out = sparklineWidget.render(state, makeCtx({ height: 5 }), 'Sparkline');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('waiting for data');
  });

  test('renders output rows equal to ctx.height', () => {
    const state = sparklineWidget.initialState({
      samples: Array.from({ length: 30 }, (_, i) => Math.sin(i / 5)),
    });
    const out = sparklineWidget.render(state, makeCtx({ height: 8 }), 'S');
    expect(out).toHaveLength(8);
    // Line 0 is the title — body rows should contain braille glyphs or spaces.
    for (let i = 1; i < 8; i++) {
      expect(out[i]?.length).toBeGreaterThan(0);
    }
  });

  test('overlay label shows current value', () => {
    const state = sparklineWidget.initialState({
      samples: [0, 5, 10, 15, 20],
      unit: '%',
    });
    const out = sparklineWidget.render(state, makeCtx({ height: 6 }), 'CPU');
    const plain = out.map(stripAnsi).join('\n');
    // Last sample is 20 — formatted with 1 decimal because abs ≥ 10.
    expect(plain).toContain('20.0%');
  });

  test('bad dimensions degrade gracefully', () => {
    const state = sparklineWidget.initialState({ samples: [1, 2, 3] });
    expect(sparklineWidget.render(state, makeCtx({ width: 1 }), 'x')).toEqual([]);
    expect(sparklineWidget.render(state, makeCtx({ height: 0 }), 'x')).toEqual([]);
  });
});

describe('sparkline onKey', () => {
  test('c clears the ring buffer', () => {
    const state = sparklineWidget.initialState({ samples: [1, 2, 3, 4, 5] });
    const ctx = makeCtx();
    const action = sparklineWidget.onKey!({ name: 'c' } as any, state, ctx);
    expect(state.samples).toEqual([]);
    expect(action).toEqual({ type: 'refresh' });
  });

  test('other keys are no-op', () => {
    const state = sparklineWidget.initialState({ samples: [1, 2, 3] });
    const ctx = makeCtx();
    expect(sparklineWidget.onKey!({ name: 'x' } as any, state, ctx))
      .toEqual({ type: 'none' });
  });

  test('c emits a telemetry event', () => {
    const state = sparklineWidget.initialState({ samples: [1, 2] });
    const emitted: any[] = [];
    const ctx = makeCtx();
    ctx.telemetry = { emit: (e: any) => emitted.push(e) };
    sparklineWidget.onKey!({ name: 'c' } as any, state, ctx);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe('sparkline.cleared');
  });
});

describe('sparkline snapshot override', () => {
  test('empty state reports zero samples', () => {
    const state = sparklineWidget.initialState();
    const snap = sparklineWidget.snapshot!(state, makeCtx());
    expect(snap).toEqual({ samples: 0, min: null, max: null, avg: null, last: null });
  });

  test('computes min/max/avg/last/unit', () => {
    const state = sparklineWidget.initialState({
      samples: [1, 2, 3, 4, 5],
      unit: 'ms',
    });
    const snap = sparklineWidget.snapshot!(state, makeCtx()) as Record<string, unknown>;
    expect(snap.samples).toBe(5);
    expect(snap.min).toBe(1);
    expect(snap.max).toBe(5);
    expect(snap.avg).toBe(3);
    expect(snap.last).toBe(5);
    expect(snap.unit).toBe('ms');
  });

  test('handles negative + mixed values', () => {
    const state = sparklineWidget.initialState({ samples: [-5, 0, 5, 10] });
    const snap = sparklineWidget.snapshot!(state, makeCtx()) as Record<string, number>;
    expect(snap.min).toBe(-5);
    expect(snap.max).toBe(10);
    expect(snap.avg).toBe(2.5);
  });
});

describe('sparkline describe override', () => {
  test('row 0 is the title', () => {
    const state = sparklineWidget.initialState({ samples: [1, 2, 3] });
    const desc = sparklineWidget.describe!(state, makeCtx(), 0, 5);
    expect(desc).toContain('title row');
  });

  test('empty state reports "no data yet"', () => {
    const state = sparklineWidget.initialState();
    const desc = sparklineWidget.describe!(state, makeCtx(), 2, 3);
    expect(desc).toContain('no data');
  });

  test('points at a specific sample by col', () => {
    const state = sparklineWidget.initialState({ samples: [10, 20, 30, 40, 50] });
    const desc = sparklineWidget.describe!(state, makeCtx(), 1, 0);
    expect(desc).toContain('sample[0]');
    expect(desc).toContain('10');
  });
});

describe('sparkline onMouse', () => {
  test('click selects a sample and updates overlay badge', () => {
    const state = sparklineWidget.initialState({ samples: [10, 20, 30, 40, 50] });
    const ctx = makeCtx({ width: 30, height: 6 });
    sparklineWidget.render(state, ctx, 'Sparkline');

    const action = sparklineWidget.onMouse!(
      { type: 'click', row: 2, col: 15 } as never,
      state,
      ctx,
    );
    expect(action).toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(4);

    const out = sparklineWidget.render(state, ctx, 'Sparkline');
    expect(stripAnsi(out[1]!)).toContain('idx 4');
    expect(stripAnsi(out[1]!)).toContain('50');
  });

  test('title-row is reserved and first body row starts at row 1', () => {
    const state = sparklineWidget.initialState({ samples: [10, 20, 30, 40, 50] });
    const ctx = makeCtx({ width: 20, height: 5 });
    sparklineWidget.render(state, ctx, 'Sparkline');

    const action = sparklineWidget.onMouse!(
      { type: 'click', row: 1, col: 0 } as never,
      state,
      ctx,
    );
    expect(action).toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(0);
  });

  test('scroll wheel nudges selected sample', () => {
    const state = sparklineWidget.initialState({ samples: [10, 20, 30, 40, 50] });
    const ctx = makeCtx();
    expect(sparklineWidget.onMouse!({ type: 'scroll-up', row: 1, col: 0 } as never, state, ctx))
      .toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(3);
    expect(sparklineWidget.onMouse!({ type: 'scroll-down', row: 1, col: 0 } as never, state, ctx))
      .toEqual({ type: 'refresh' });
    expect(state.selectedIndex).toBe(4);
  });
});
