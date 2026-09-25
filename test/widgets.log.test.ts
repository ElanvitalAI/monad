import { describe, expect, test } from 'bun:test';
import logWidget, { type LogWidgetState } from '../widgets/log/widget.js';
import { stripAnsi } from '../src/tui.js';

const ctx = (overrides: Partial<{ width: number; height: number; focused: boolean }> = {}) => ({
  width: overrides.width ?? 80,
  height: overrides.height ?? 10,
  focused: overrides.focused ?? true,
});

describe('log widget', () => {
  test('initialState seeds scroll=0 and tail-follow scrollOffset=-1', () => {
    const state = logWidget.initialState();
    expect(state.scroll).toBe(0);
    expect(state.scrollOffset).toBe(-1);
    expect(state.lines).toEqual([]);
    expect(state.focused).toBe(false);
  });

  test('declares Scrollable behavior', () => {
    const behaviors = logWidget.behaviors ?? [];
    expect(behaviors.map((b) => b.name)).toContain('scrollable');
  });

  test('Scrollable behavior mutates scroll on j/k with maxScroll clamp', () => {
    const state: LogWidgetState = logWidget.initialState();
    state.scroll = 0;
    state.maxScroll = 5;
    const scroll = logWidget.behaviors!.find((b) => b.name === 'scrollable')!;

    scroll.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.scroll).toBe(1);

    // Clamp to maxScroll on repeated j.
    for (let i = 0; i < 20; i++) {
      scroll.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    }
    expect(state.scroll).toBe(5);

    scroll.onKey!({ name: 'k', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.scroll).toBe(4);
  });

  test('Scrollable behavior respects pageSize from state', () => {
    const state: LogWidgetState = logWidget.initialState();
    state.scroll = 0;
    state.maxScroll = 100;
    state.pageSize = 20;
    const scroll = logWidget.behaviors!.find((b) => b.name === 'scrollable')!;

    scroll.onKey!({ name: 'pagedown', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.scroll).toBe(20);
  });

  test('Scrollable G jumps to maxScroll, g resets to 0', () => {
    const state: LogWidgetState = logWidget.initialState();
    state.scroll = 10;
    state.maxScroll = 50;
    const scroll = logWidget.behaviors!.find((b) => b.name === 'scrollable')!;

    scroll.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.scroll).toBe(50);

    scroll.onKey!({ name: 'g', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.scroll).toBe(0);
  });

  test('render delegates to log-pane — shows lines and title', () => {
    const state: LogWidgetState = logWidget.initialState({
      lines: ['hello world', 'second line'],
    });
    const out = logWidget.render(state, ctx({ height: 5 }), 'Log');
    const plain = out.map(stripAnsi).join('\n');

    expect(out).toHaveLength(5);
    expect(plain).toContain('Log');
    expect(plain).toContain('hello world');
    expect(plain).toContain('second line');
  });

  test('footerLine pins to the last body row', () => {
    const state: LogWidgetState = logWidget.initialState({
      lines: ['line-a', 'line-b', 'line-c'],
    });
    state.footerLine = '⟳ thinking...';
    const out = logWidget.render(state, ctx({ height: 6 }), 'Log');
    const plain = out.map(stripAnsi);

    expect(plain[plain.length - 1]).toContain('thinking');
  });
});
