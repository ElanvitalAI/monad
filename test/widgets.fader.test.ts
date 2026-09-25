// Fader widget tests — Phase 4 P2a.

import { describe, expect, test } from 'bun:test';
import faderWidget, { type FaderState } from '../widgets/fader/widget.js';
import { AnimationController } from '../src/animation/index.js';
import { stripAnsi } from '../src/tui.js';

// Build a test ctx that lets us control the animation clock + capture telemetry.
function makeCtx(
  opts: {
    width?: number;
    height?: number;
    focused?: boolean;
    animProgress?: number;
  } = {},
): { ctx: any; animator: AnimationController; clock: { now: number }; emitted: any[] } {
  const animator = new AnimationController();
  const clock = { now: 1_000_000 };
  animator._setNowForTesting(() => clock.now);
  const emitted: any[] = [];
  return {
    animator,
    clock,
    emitted,
    ctx: {
      widgetId: 'wd-fade',
      widgetType: 'fader',
      character: 'Notice',
      width: opts.width ?? 30,
      height: opts.height ?? 3,
      focused: opts.focused ?? false,
      setState: () => {},
      requestRender: () => {},
      dismiss: () => {},
      log: () => {},
      animate: {
        tween: (spec: any) => animator.tween(spec),
        progress: () => opts.animProgress ?? 1,
        isDone: () => true,
        hasActive: () => false,
        cancel: () => {},
      },
      telemetry: { emit: (e: any) => emitted.push(e) },
    },
  };
}

describe('fader initialState', () => {
  test('defaults', () => {
    const s = faderWidget.initialState();
    expect(s.phase).toBe('fade-in');
    expect(s.tone).toBe('info');
    expect(s.message).toBe('');
    expect(s.autoDismissMs).toBe(0);
  });

  test('honours config', () => {
    const s = faderWidget.initialState({
      message: 'Saved!',
      tone: 'success',
      autoDismissMs: 1500,
    });
    expect(s.message).toBe('Saved!');
    expect(s.tone).toBe('success');
    expect(s.autoDismissMs).toBe(1500);
  });
});

describe('fader onMount', () => {
  test('stamps mountedAt + starts fade-in tween + emits telemetry', () => {
    const { ctx, emitted } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi', tone: 'info' });
    faderWidget.onMount!(state, ctx);
    expect(state.mountedAt).toBeGreaterThan(0);
    expect(emitted[0]?.kind).toBe('fader.mounted');
    expect(emitted[0]?.data?.tone).toBe('info');
  });
});

describe('fader render', () => {
  test('fade-in with low progress shows muted message', () => {
    const { ctx } = makeCtx({ animProgress: 0.2 });
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    const out = faderWidget.render(state, ctx, 'Notice');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('hi');
    expect(out).toHaveLength(3);
  });

  test('fade-in with progress=1 transitions to shown', () => {
    const { ctx } = makeCtx({ animProgress: 1 });
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    faderWidget.render(state, ctx, 'Notice');
    expect(state.phase).toBe('shown');
  });

  test('hidden phase produces blank body', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'hidden';
    const out = faderWidget.render(state, ctx, 'Notice');
    const plain = out.map(stripAnsi);
    // Body row (index 1) should not contain 'hi' since opacity=0.
    expect(plain[1]).not.toContain('hi');
  });

  test('graceful degradation on tiny ctx', () => {
    const { ctx } = makeCtx({ width: 0, height: 0 });
    const state = faderWidget.initialState({ message: 'x' });
    expect(faderWidget.render(state, ctx, 'n')).toEqual([]);
  });
});

describe('fader onKey', () => {
  test('escape dismisses from shown state', () => {
    const { ctx, emitted } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'shown';
    const action = faderWidget.onKey!({ name: 'escape' } as any, state, ctx);
    expect(state.phase).toBe('fade-out');
    expect(action).toEqual({ type: 'refresh' });
    expect(emitted.some((e) => e.kind === 'fader.dismissed')).toBe(true);
  });

  test('enter dismisses', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'shown';
    faderWidget.onKey!({ name: 'enter' } as any, state, ctx);
    expect(state.phase).toBe('fade-out');
  });

  test('space dismisses', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'shown';
    faderWidget.onKey!({ name: 'space' } as any, state, ctx);
    expect(state.phase).toBe('fade-out');
  });

  test('other keys no-op', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'shown';
    expect(faderWidget.onKey!({ name: 'j' } as any, state, ctx))
      .toEqual({ type: 'none' });
    expect(state.phase).toBe('shown');
  });

  test('hidden phase ignores keys', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState();
    state.phase = 'hidden';
    expect(faderWidget.onKey!({ name: 'enter' } as any, state, ctx))
      .toEqual({ type: 'none' });
  });
});

describe('fader onMouse', () => {
  test('click dismisses from shown state', () => {
    const { ctx, emitted } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hi' });
    state.phase = 'shown';
    const action = faderWidget.onMouse!({ type: 'click', row: 1, col: 1 }, state, ctx);
    expect(state.phase).toBe('fade-out');
    expect(action).toEqual({ type: 'refresh' });
    expect(emitted.some((e) => e.kind === 'fader.dismissed' && e.data?.reason === 'mouse')).toBe(true);
  });

  test('hidden phase ignores mouse', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState();
    state.phase = 'hidden';
    expect(faderWidget.onMouse!({ type: 'click', row: 1, col: 1 }, state, ctx))
      .toEqual({ type: 'none' });
  });
});

describe('fader snapshot', () => {
  test('reports phase + tone + age', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({
      message: 'hello',
      tone: 'success',
      autoDismissMs: 2000,
    });
    state.mountedAt = Date.now() - 500;
    const snap = faderWidget.snapshot!(state, ctx) as Record<string, unknown>;
    expect(snap.message).toBe('hello');
    expect(snap.tone).toBe('success');
    expect(snap.autoDismissMs).toBe(2000);
    expect(typeof snap.ageMs).toBe('number');
    expect(snap.ageMs).toBeGreaterThanOrEqual(500);
  });
});

describe('fader describe', () => {
  test('row 0 is title', () => {
    const { ctx } = makeCtx();
    const state = faderWidget.initialState({ message: 'x' });
    expect(faderWidget.describe!(state, ctx, 0, 5)).toContain('title row');
  });

  test('body row reports phase + message', () => {
    const { ctx } = makeCtx();
    const state: FaderState = faderWidget.initialState({ message: 'hello world' });
    state.phase = 'shown';
    const desc = faderWidget.describe!(state, ctx, 1, 0);
    expect(desc).toContain('phase=shown');
    expect(desc).toContain('hello world');
  });
});
