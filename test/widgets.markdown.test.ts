// ── Markdown widget tests ──

import { describe, test, expect } from 'bun:test';
import markdownWidget, { wrapToWidth } from '../widgets/markdown/widget.js';
import type { RenderCtx } from '../src/widgets/types.js';

const ctx = (overrides: Partial<RenderCtx> = {}): RenderCtx => ({
  width: 20, height: 10, focused: true, ...overrides,
});

describe('wrapToWidth', () => {
  test('short line passes through', () => {
    expect(wrapToWidth('hello', 20)).toEqual(['hello']);
  });

  test('long line wraps at word boundary', () => {
    const wrapped = wrapToWidth('the quick brown fox jumps', 10);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped[0]!.length).toBeLessThanOrEqual(10);
  });

  test('collapses multiple blank lines to one', () => {
    const wrapped = wrapToWidth('a\n\n\n\nb', 20);
    expect(wrapped).toEqual(['a', '', 'b']);
  });

  test('handles text that exactly fills width', () => {
    const line = 'abcdefghij';  // 10 chars
    const wrapped = wrapToWidth(line, 10);
    expect(wrapped).toEqual([line]);
  });
});

describe('markdown widget', () => {
  test('initialState uses config text', () => {
    const s = markdownWidget.initialState({ text: 'hello\nworld' });
    expect(s.text).toBe('hello\nworld');
    expect(s.scroll).toBe(0);
  });

  test('render produces title + wrapped body', () => {
    const state = markdownWidget.initialState({ text: 'short line' });
    const out = markdownWidget.render(state, ctx(), 'Doc');
    expect(out).toHaveLength(10);
    expect(out[0]).toContain('Doc');
    expect(out[1]).toContain('short line');
  });

  test('render clamps scroll to maxScroll', () => {
    const state = markdownWidget.initialState({ text: 'line' });
    state.scroll = 999;
    const out = markdownWidget.render(state, ctx(), '');
    // Should not crash; body lines present
    expect(out).toHaveLength(10);
  });

  test('Scrollable behavior: j/k adjusts scroll', () => {
    // Phase 3b (2026-04-20): markdown no longer has its own onKey.
    // Scroll keys flow through the Scrollable behavior instead.
    const state = markdownWidget.initialState({ text: 'a\nb\nc' });
    const scroll = markdownWidget.behaviors!.find((b) => b.name === 'scrollable')!;
    const call = (name: string) => scroll.onKey!(
      { name, ctrl: false, shift: false } as never,
      state as never,
      {} as never,
    );
    call('j');
    expect(state.scroll).toBe(1);
    call('k');
    expect(state.scroll).toBe(0);
    call('k');
    expect(state.scroll).toBe(0);  // clamped at 0
  });

  test('Scrollable behavior: pagedown/pageup jumps by 10', () => {
    const state = markdownWidget.initialState({ text: 'x' });
    const scroll = markdownWidget.behaviors!.find((b) => b.name === 'scrollable')!;
    const call = (name: string) => scroll.onKey!(
      { name, ctrl: false, shift: false } as never,
      state as never,
      {} as never,
    );
    call('pagedown');
    expect(state.scroll).toBe(10);
    call('pageup');
    expect(state.scroll).toBe(0);
  });

  test('onMouse scroll wheel mutates scroll', () => {
    const state = markdownWidget.initialState({
      text: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'),
    });
    markdownWidget.render(state, ctx({ height: 6 }), 'Doc');
    expect(markdownWidget.onMouse!({ type: 'scroll-down', row: 2, col: 0 }, state, {} as never))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(1);
    expect(markdownWidget.onMouse!({ type: 'scroll-up', row: 2, col: 0 }, state, {} as never))
      .toEqual({ type: 'refresh' });
    expect(state.scroll).toBe(0);
  });
});
