// ── List widget tests ──

import { describe, test, expect } from 'bun:test';
import listWidget from '../widgets/list/widget.js';
import type { RenderCtx } from '../src/widgets/types.js';

const ctx = (overrides: Partial<RenderCtx> = {}): RenderCtx => ({
  width: 30, height: 10, focused: true, ...overrides,
});

describe('list widget', () => {
  test('initialState uses config items + icons', () => {
    const s = listWidget.initialState({ items: ['a', 'b'], icons: ['📦', '📦'] });
    expect(s.items).toEqual(['a', 'b']);
    expect(s.icons).toEqual(['📦', '📦']);
    expect(s.cursor).toBe(0);
    expect(s.selected.size).toBe(0);
  });

  test('render shows title row + body rows', () => {
    const state = listWidget.initialState({ items: ['alpha', 'beta'] });
    const out = listWidget.render(state, ctx(), 'Picks');
    expect(out).toHaveLength(10);              // title + 9 body
    expect(out[0]).toContain('Picks');          // title
    expect(out[1]).toContain('alpha');
    expect(out[2]).toContain('beta');
  });

  test('selection mark flips between circles', () => {
    const state = listWidget.initialState({ items: ['alpha'] });
    state.selected.add('alpha');
    const out = listWidget.render(state, ctx(), '');
    expect(out[1]).toContain('\u25CF');  // ●
    state.selected.clear();
    const out2 = listWidget.render(state, ctx(), '');
    expect(out2[1]).toContain('\u25CB');  // ○
  });

  test('onKey j/k moves cursor in bounds', () => {
    const state = listWidget.initialState({ items: ['a', 'b', 'c'] });
    listWidget.onKey!({ name: 'j' }, state, {} as any);
    expect(state.cursor).toBe(1);
    listWidget.onKey!({ name: 'j' }, state, {} as any);
    expect(state.cursor).toBe(2);
    listWidget.onKey!({ name: 'j' }, state, {} as any);
    expect(state.cursor).toBe(2);  // clamped
    listWidget.onKey!({ name: 'k' }, state, {} as any);
    expect(state.cursor).toBe(1);
  });

  test('onKey space toggles selection + auto-advances cursor', () => {
    const state = listWidget.initialState({ items: ['x', 'y'] });
    listWidget.onKey!({ name: 'space' }, state, {} as any);
    expect(state.selected.has('x')).toBe(true);
    expect(state.cursor).toBe(1);
    listWidget.onKey!({ name: 'space' }, state, {} as any);
    expect(state.selected.has('y')).toBe(true);
  });

  test('onKey a toggles select-all vs clear', () => {
    const state = listWidget.initialState({ items: ['x', 'y', 'z'] });
    listWidget.onKey!({ name: 'a' }, state, {} as any);
    expect(state.selected.size).toBe(3);
    listWidget.onKey!({ name: 'a' }, state, {} as any);
    expect(state.selected.size).toBe(0);
  });

  test('render keeps cursor in view via offset adjust', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item${i}`);
    const state = listWidget.initialState({ items });
    state.cursor = 30;
    listWidget.render(state, ctx({ height: 10 }), 'Long');
    expect(state.offset).toBeGreaterThan(0);
    expect(state.cursor).toBeGreaterThanOrEqual(state.offset);
  });

  test('render produces one line per row height even when items exhaust', () => {
    const state = listWidget.initialState({ items: ['only'] });
    const out = listWidget.render(state, ctx({ height: 5 }), 'T');
    expect(out).toHaveLength(5);
  });

  test('Cursorable behavior drives cursor via getItemCount injector', () => {
    // Phase 7 Batch C (2026-04-20) — list widget declares
    // behaviors: [cursorable(getItemCount)]. Dispatch-path calls see
    // the behavior; direct onKey calls still work (backward compat).
    const state = listWidget.initialState({ items: ['a', 'b', 'c', 'd'] });
    const cursor = listWidget.behaviors!.find((b) => b.name === 'cursorable');
    expect(cursor).toBeDefined();

    cursor!.onKey!({ name: 'G', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(3);
    cursor!.onKey!({ name: 'g', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(0);
    cursor!.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(1);
    // Clamp at items.length - 1
    for (let i = 0; i < 10; i++) {
      cursor!.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    }
    expect(state.cursor).toBe(3);
  });

  test('Cursorable is a no-op on empty items', () => {
    const state = listWidget.initialState({ items: [] });
    const cursor = listWidget.behaviors!.find((b) => b.name === 'cursorable')!;
    cursor.onKey!({ name: 'j', ctrl: false, shift: false } as never, state as never, {} as never);
    expect(state.cursor).toBe(0);
  });
});
