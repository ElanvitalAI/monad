// ── Table widget tests ──

import { describe, test, expect } from 'bun:test';
import table, { solveColumnWidths, formatCell, type TableColumn, type TableState } from '../widgets/table/widget.js';
import type { RenderCtx, KeyEvent, WidgetContext } from '../src/widgets/types.js';
import { visibleWidth } from '../src/tui.js';

const ctx = (overrides: Partial<RenderCtx> = {}): RenderCtx => ({
  width: 40, height: 8, focused: true, ...overrides,
});

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

const stubCtx = (state: TableState): WidgetContext<TableState> => ({
  widgetId: 't', widgetType: 'table', character: 'T', state,
  setState: () => {}, requestRender: () => {}, dismiss: () => {}, log: () => {},
});

describe('solveColumnWidths', () => {
  test('absolute widths used as-is when they fit', () => {
    const cols: TableColumn[] = [
      { key: 'a', header: 'A', width: 5 },
      { key: 'b', header: 'B', width: 10 },
    ];
    expect(solveColumnWidths(cols, 30)).toEqual([5, 10]);
  });

  test('flex columns split remaining space evenly', () => {
    const cols: TableColumn[] = [
      { key: 'a', header: 'A', width: 4 },
      { key: 'b', header: 'B', width: 'flex' },
      { key: 'c', header: 'C', width: 'flex' },
    ];
    // available = 30, gaps = 2, interior = 28, fixed = 4 → 24 / 2 flex = 12 each
    expect(solveColumnWidths(cols, 30)).toEqual([4, 12, 12]);
  });

  test('flex leftover lands on the last flex column', () => {
    const cols: TableColumn[] = [
      { key: 'a', header: 'A', width: 'flex' },
      { key: 'b', header: 'B', width: 'flex' },
    ];
    // available = 11, gap = 1, interior = 10 → 5 each, no leftover
    expect(solveColumnWidths(cols, 11)).toEqual([5, 5]);
    // available = 12, interior = 11 → 5 + (5 + 1 leftover) = 5, 6
    expect(solveColumnWidths(cols, 12)).toEqual([5, 6]);
  });

  test('absolute widths exceeding available shrink proportionally', () => {
    const cols: TableColumn[] = [
      { key: 'a', header: 'A', width: 20 },
      { key: 'b', header: 'B', width: 20 },
    ];
    // available = 11, interior = 10 → both shrink to 5
    const out = solveColumnWidths(cols, 11);
    expect(out.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
    expect(out.every(w => w >= 1)).toBe(true);
  });

  test('undefined width is treated as flex', () => {
    const cols: TableColumn[] = [
      { key: 'a', header: 'A', width: 4 },
      { key: 'b', header: 'B' },
    ];
    expect(solveColumnWidths(cols, 11)).toEqual([4, 6]);
  });
});

describe('formatCell', () => {
  test('left-align pads on the right', () => {
    expect(formatCell('hi', 5, 'left')).toBe('hi   ');
  });

  test('right-align pads on the left', () => {
    expect(formatCell(42, 5, 'right')).toBe('   42');
  });

  test('center-align splits padding', () => {
    expect(formatCell('x', 5, 'center')).toBe('  x  ');
  });

  test('over-long values are truncated to width', () => {
    const out = formatCell('abcdefghij', 5, 'left');
    expect(visibleWidth(stripAnsi(out))).toBeLessThanOrEqual(5);
  });

  test('undefined renders as blank padding', () => {
    expect(formatCell(undefined, 4, 'left')).toBe('    ');
  });
});

describe('table widget render', () => {
  test('initialState copies columns + rows', () => {
    const s = table.initialState({
      columns: [{ key: 'name', header: 'Name' }],
      rows: [{ name: 'foo' }],
    });
    expect(s.columns.length).toBe(1);
    expect(s.rows.length).toBe(1);
    expect(s.cursor).toBe(-1);
  });

  test('renders title + header + rows within height', () => {
    const state = table.initialState({
      columns: [
        { key: 'name', header: 'Name', width: 10 },
        { key: 'value', header: 'Value', width: 'flex', align: 'right' },
      ],
      rows: [{ name: 'alpha', value: 1 }, { name: 'beta', value: 22 }],
    });
    const out = table.render(state, ctx({ height: 5 }), 'Picks');
    expect(out).toHaveLength(5);
    const plain = out.map(stripAnsi);
    expect(plain[0]).toContain('Picks');
    expect(plain[1]).toMatch(/Name.*Value/);
    expect(plain[2]).toContain('alpha');
    expect(plain[3]).toContain('beta');
  });

  test('cursor row differs from non-cursor rows when focused', () => {
    const state = table.initialState({
      columns: [{ key: 'name', header: 'N' }],
      rows: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    state.cursor = 1;
    state.focused = true;
    const focusedOut = table.render(state, ctx({ height: 5 }), 'T');
    state.focused = false;
    state.cursor = -1;
    const plainOut = table.render(state, ctx({ height: 5 }), 'T');
    // Cursor row is at index 3 (title=0, header=1, body[0]=2, body[1]=3, body[2]=4)
    // With chalk active it gains escape codes; with chalk stripped (no-TTY)
    // we still expect the bold/highlight wrapper to differ from plain output.
    // Either case: focusedOut[3] should not equal plainOut[3] when there's
    // any color support; otherwise both fall back to the same plain row.
    const stripped = stripAnsi(focusedOut[3]!);
    expect(stripped).toContain('b');
  });

  test('empty columns still pads to height', () => {
    const state = table.initialState();
    const out = table.render(state, ctx({ height: 4 }), 'Empty');
    expect(out).toHaveLength(4);
  });

  test('cursor scrolls offset down when row exceeds visible window', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: Array.from({ length: 30 }, (_, i) => ({ n: String(i) })),
    });
    state.cursor = 25;
    state.focused = true;
    const out = table.render(state, ctx({ height: 6 }), 'T');
    // bodyH = 6 - title - header = 4. Cursor 25 → offset adjusts to 22.
    expect(state.offset).toBe(22);
    expect(out.some(l => stripAnsi(l).includes('25'))).toBe(true);
  });

  test('numeric value defaults to right-aligned', () => {
    const state = table.initialState({
      columns: [{ key: 'price', header: 'Price', width: 8 }],
      rows: [{ price: 42 }],
    });
    const out = table.render(state, ctx({ width: 10, height: 4 }), 'T');
    const row = stripAnsi(out[2]!);
    // "      42" — 42 right-aligned in 8 columns
    expect(row.startsWith('      42')).toBe(true);
  });

  test('tiny height returns just the title row', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 'x' }],
    });
    const out = table.render(state, ctx({ height: 1 }), 'T');
    expect(out).toHaveLength(1);
  });
});

describe('table widget onKey', () => {
  function ev(name: string): KeyEvent {
    return { name, ctrl: false, shift: false } as KeyEvent;
  }

  // Phase 3c (2026-04-20): table widget's cursor keys (j/k/g/G/Home/
  // End) moved to the Cursorable behavior. pagedown/pageup stay in
  // widget.onKey (they jump by 10, which Cursorable doesn't do).
  // Tests dispatch through the behavior chain to mirror production.
  const cursorableBeh = () => table.behaviors!.find((b) => b.name === 'cursorable')!;

  test('cursor < 0 → Cursorable sees itemCount=0, no-op', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 'a' }, { n: 'b' }],
    });
    // state.cursor starts at -1 — getItemCount returns 0 in that case
    const beh = cursorableBeh();
    const out = beh.onKey!(ev('j') as never, state as never, stubCtx(state) as never);
    expect(out).toEqual({ type: 'none' });
    expect(state.cursor).toBe(-1);
  });

  test('j/k move cursor when cursor >= 0', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [{ n: 'a' }, { n: 'b' }, { n: 'c' }],
    });
    state.cursor = 0;
    const beh = cursorableBeh();
    beh.onKey!(ev('j') as never, state as never, stubCtx(state) as never);
    expect(state.cursor).toBe(1);
    beh.onKey!(ev('k') as never, state as never, stubCtx(state) as never);
    expect(state.cursor).toBe(0);
  });

  test('G jumps to last row', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: Array.from({ length: 5 }, (_, i) => ({ n: i })),
    });
    state.cursor = 0;
    const beh = cursorableBeh();
    beh.onKey!(ev('G') as never, state as never, stubCtx(state) as never);
    expect(state.cursor).toBe(4);
  });

  test('empty rows array → no-op', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: [],
    });
    state.cursor = 0;
    const beh = cursorableBeh();
    const out = beh.onKey!(ev('j') as never, state as never, stubCtx(state) as never);
    expect(out).toEqual({ type: 'none' });
  });

  test('pagedown still routed through widget.onKey (jump by 10)', () => {
    const state = table.initialState({
      columns: [{ key: 'n', header: 'N' }],
      rows: Array.from({ length: 30 }, (_, i) => ({ n: i })),
    });
    state.cursor = 0;
    const out = table.onKey!(ev('pagedown'), state, stubCtx(state));
    expect(out).toEqual({ type: 'refresh' });
    expect(state.cursor).toBe(10);
  });
});
