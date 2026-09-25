// Scratch widget tests — Phase 7 Batch S1 (foundation + preview mode).

import { describe, expect, test } from 'bun:test';
import scratchWidget, { type ScratchState } from '../widgets/scratch/widget.js';
import { stripAnsi } from '../src/tui.js';

function ctxOf(overrides: { width?: number; height?: number; focused?: boolean } = {}): any {
  return {
    widgetId: 'wd-scratch',
    widgetType: 'scratch',
    character: 'Scratch',
    width: overrides.width ?? 40,
    height: overrides.height ?? 8,
    focused: overrides.focused ?? true,
    setState: () => {},
    requestRender: () => {},
    dismiss: () => {},
    log: () => {},
  };
}

describe('scratch initialState', () => {
  test('defaults to preview mode', () => {
    const s = scratchWidget.initialState();
    expect(s.mode).toBe('preview');
    expect(s.previewLines).toEqual([]);
    expect(s.memoLines).toEqual(['']);
    expect(s.clipHistory).toEqual([]);
  });

  test('config seeds specified mode + data', () => {
    const s = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['hello', 'world'],
    });
    expect(s.mode).toBe('memo');
    expect(s.memoLines).toEqual(['hello', 'world']);
  });

  test('preview config seeds lines and path', () => {
    const s = scratchWidget.initialState({
      mode: 'preview',
      previewLines: ['a', 'b', 'c'],
      previewPath: '/tmp/file.md',
    });
    expect(s.previewLines).toEqual(['a', 'b', 'c']);
    expect(s.previewPath).toBe('/tmp/file.md');
  });

  test('clipboard config seeds history', () => {
    const entries = [
      { id: 'c1', text: 'first' },
      { id: 'c2', text: 'second' },
    ];
    const s = scratchWidget.initialState({ mode: 'clipboard', clipHistory: entries });
    expect(s.clipHistory).toHaveLength(2);
  });
});

describe('scratch render — preview mode', () => {
  test('empty preview shows hint', () => {
    const s = scratchWidget.initialState({ mode: 'preview' });
    const out = scratchWidget.render(s, ctxOf({ height: 4 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('no preview content');
    expect(plain).toContain('preview');
  });

  test('shows title suffix with mode label', () => {
    const s = scratchWidget.initialState({ mode: 'preview', previewLines: ['x'] });
    const out = scratchWidget.render(s, ctxOf({ height: 4 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('Scratch');
    expect(plain).toContain('preview');
  });

  test('renders preview lines within bodyH', () => {
    const s = scratchWidget.initialState({
      mode: 'preview',
      previewLines: ['alpha', 'beta', 'gamma', 'delta'],
    });
    const out = scratchWidget.render(s, ctxOf({ height: 5 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('alpha');
    expect(plain).toContain('delta');
  });

  test('Scrollable scroll affects window', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const s: ScratchState = scratchWidget.initialState({ mode: 'preview', previewLines: lines });
    s.scroll = 5;
    const out = scratchWidget.render(s, ctxOf({ height: 4 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('line 5');
    expect(plain).not.toContain('line 0');
  });

  test('maxScroll is populated during render', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: Array.from({ length: 10 }, (_, i) => `r${i}`),
    });
    scratchWidget.render(s, ctxOf({ height: 5 }), 'Scratch');
    // 10 lines, bodyH = 4 → maxScroll = 6
    expect(s.maxScroll).toBe(6);
  });
});

describe('scratch render — memo mode (S1 skeleton)', () => {
  test('renders lines with cursor indicator when focused', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['first line', 'second line'],
    });
    s.memoLineIdx = 0;
    s.memoColIdx = 5;
    const out = scratchWidget.render(s, ctxOf({ height: 5, focused: true }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    // Cursor glyph appears at column 5 of line 0
    expect(plain).toContain('first');
    expect(plain).toContain('second');
  });

  test('memo without focus still renders lines', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['abc'],
    });
    const out = scratchWidget.render(s, ctxOf({ height: 3, focused: false }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('abc');
  });
});

describe('scratch render — clipboard mode', () => {
  test('empty history shows hint', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'clipboard' });
    const out = scratchWidget.render(s, ctxOf({ height: 4 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('clipboard history empty');
  });

  test('renders entries with ids', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'alpha content' },
        { id: 'c2', text: 'beta content' },
      ],
    });
    const out = scratchWidget.render(s, ctxOf({ height: 5 }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('c1');
    expect(plain).toContain('alpha');
    expect(plain).toContain('c2');
  });

  test('cursor position highlighted', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'first' },
        { id: 'c2', text: 'second' },
      ],
    });
    s.clipCursor = 1;
    const out = scratchWidget.render(s, ctxOf({ height: 5, focused: true }), 'Scratch');
    const plain = out.map(stripAnsi);
    // Cursor row should include 'c2'
    const cursorRow = plain.find((l) => l.includes('c2'));
    expect(cursorRow).toBeTruthy();
  });
});

describe('scratch preview-mode scroll (onKey)', () => {
  test('behaviors array is empty — onKey handles everything', () => {
    expect(scratchWidget.behaviors).toEqual([]);
  });

  test('preview j/k/G mutate scroll via onKey', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: Array.from({ length: 20 }, (_, i) => `r${i}`),
    });
    s.maxScroll = 16;
    scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(s.scroll).toBe(1);
    scratchWidget.onKey!({ name: 'G' } as any, s, {} as any);
    expect(s.scroll).toBe(16);
    scratchWidget.onKey!({ name: 'g' } as any, s, {} as any);
    expect(s.scroll).toBe(0);
    scratchWidget.onKey!({ name: 'pagedown' } as any, s, {} as any);
    expect(s.scroll).toBe(10);
  });
});

describe('scratch onMouse', () => {
  test('preview scroll wheel mutates scroll', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: Array.from({ length: 20 }, (_, i) => `r${i}`),
    });
    s.maxScroll = 16;
    expect(scratchWidget.onMouse!({ type: 'scroll-down', row: 2, col: 0 }, s, ctxOf()))
      .toEqual({ type: 'refresh' });
    expect(s.scroll).toBe(1);
    expect(scratchWidget.onMouse!({ type: 'scroll-up', row: 2, col: 0 }, s, ctxOf()))
      .toEqual({ type: 'refresh' });
    expect(s.scroll).toBe(0);
  });

  test('clipboard click selects row and double-click submits text', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'alpha' },
        { id: 'c2', text: 'beta' },
      ],
    });
    expect(scratchWidget.onMouse!({ type: 'click', row: 2, col: 0 }, s, ctxOf()))
      .toEqual({ type: 'refresh' });
    expect(s.clipCursor).toBe(1);
    expect(scratchWidget.onMouse!({ type: 'double-click', row: 2, col: 0 }, s, ctxOf()))
      .toEqual({ type: 'submit', text: 'beta' });
  });
});

describe('scratch snapshot', () => {
  test('reports mode + sub-state summaries', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['a', 'b', 'c'],
    });
    s.memoLineIdx = 1;
    s.memoColIdx = 2;
    s.memoDirty = true;
    const snap = scratchWidget.snapshot!(s, ctxOf()) as Record<string, any>;
    expect(snap.mode).toBe('memo');
    expect(snap.memo.lines).toBe(3);
    expect(snap.memo.cursor).toEqual({ line: 1, col: 2 });
    expect(snap.memo.dirty).toBe(true);
  });

  test('reports preview details', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: ['x', 'y', 'z'],
      previewPath: '/p',
    });
    s.scroll = 1;
    const snap = scratchWidget.snapshot!(s, ctxOf()) as Record<string, any>;
    expect(snap.preview.lines).toBe(3);
    expect(snap.preview.path).toBe('/p');
    expect(snap.preview.scroll).toBe(1);
  });
});

describe('scratch memo onKey — editor (S2)', () => {
  test('printable char inserts at cursor', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['hello'];
    s.memoColIdx = 3;
    const action = scratchWidget.onKey!({ name: 'X' } as any, s, {} as any);
    expect(s.memoLines[0]).toBe('helXlo');
    expect(s.memoColIdx).toBe(4);
    expect(s.memoDirty).toBe(true);
    expect(action).toEqual({ type: 'refresh' });
  });

  test('backspace deletes char before cursor', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['hello'];
    s.memoColIdx = 3;
    scratchWidget.onKey!({ name: 'backspace' } as any, s, {} as any);
    expect(s.memoLines[0]).toBe('helo');
    expect(s.memoColIdx).toBe(2);
  });

  test('backspace at col 0 with prev line merges', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc', 'def'];
    s.memoLineIdx = 1;
    s.memoColIdx = 0;
    scratchWidget.onKey!({ name: 'backspace' } as any, s, {} as any);
    expect(s.memoLines).toEqual(['abcdef']);
    expect(s.memoLineIdx).toBe(0);
    expect(s.memoColIdx).toBe(3);
  });

  test('backspace at first col of first line is no-op', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc'];
    const action = scratchWidget.onKey!({ name: 'backspace' } as any, s, {} as any);
    expect(action).toEqual({ type: 'none' });
    expect(s.memoLines).toEqual(['abc']);
  });

  test('enter splits line at cursor', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['hello world'];
    s.memoColIdx = 5;
    scratchWidget.onKey!({ name: 'enter' } as any, s, {} as any);
    expect(s.memoLines).toEqual(['hello', ' world']);
    expect(s.memoLineIdx).toBe(1);
    expect(s.memoColIdx).toBe(0);
    expect(s.memoDirty).toBe(true);
  });

  test('left arrow decrements col', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc'];
    s.memoColIdx = 2;
    scratchWidget.onKey!({ name: 'left' } as any, s, {} as any);
    expect(s.memoColIdx).toBe(1);
  });

  test('left at col 0 wraps to end of prev line', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc', 'def'];
    s.memoLineIdx = 1;
    s.memoColIdx = 0;
    scratchWidget.onKey!({ name: 'left' } as any, s, {} as any);
    expect(s.memoLineIdx).toBe(0);
    expect(s.memoColIdx).toBe(3);
  });

  test('right arrow increments col', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc'];
    s.memoColIdx = 0;
    scratchWidget.onKey!({ name: 'right' } as any, s, {} as any);
    expect(s.memoColIdx).toBe(1);
  });

  test('right at end wraps to start of next line', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc', 'def'];
    s.memoLineIdx = 0;
    s.memoColIdx = 3;
    scratchWidget.onKey!({ name: 'right' } as any, s, {} as any);
    expect(s.memoLineIdx).toBe(1);
    expect(s.memoColIdx).toBe(0);
  });

  test('up/down change line + clamp col', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['long line', 'short'];
    s.memoLineIdx = 0;
    s.memoColIdx = 8;
    scratchWidget.onKey!({ name: 'down' } as any, s, {} as any);
    expect(s.memoLineIdx).toBe(1);
    expect(s.memoColIdx).toBe(5); // clamped to 'short'.length
  });

  test('k/j vi-style nav', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['a', 'b', 'c'];
    s.memoLineIdx = 0;
    scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(s.memoLineIdx).toBe(1);
    scratchWidget.onKey!({ name: 'k' } as any, s, {} as any);
    expect(s.memoLineIdx).toBe(0);
  });

  test('home/end move to extremes', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['hello'];
    s.memoColIdx = 2;
    scratchWidget.onKey!({ name: 'home' } as any, s, {} as any);
    expect(s.memoColIdx).toBe(0);
    scratchWidget.onKey!({ name: 'end' } as any, s, {} as any);
    expect(s.memoColIdx).toBe(5);
  });

  test('Ctrl+chord leaves state alone', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'memo' });
    s.memoLines = ['abc'];
    const action = scratchWidget.onKey!({ name: 's', ctrl: true } as any, s, {} as any);
    expect(action).toEqual({ type: 'none' });
    expect(s.memoLines).toEqual(['abc']);
  });
});

describe('scratch clipboard onKey — navigation (S2)', () => {
  test('j/k move cursor within history', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'a' },
        { id: 'c2', text: 'b' },
        { id: 'c3', text: 'c' },
      ],
    });
    scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(s.clipCursor).toBe(1);
    scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(s.clipCursor).toBe(2);
    // Clamp at end
    scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(s.clipCursor).toBe(2);
    scratchWidget.onKey!({ name: 'k' } as any, s, {} as any);
    expect(s.clipCursor).toBe(1);
  });

  test('G jumps to end, g to start', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [
        { id: 'c1', text: 'a' },
        { id: 'c2', text: 'b' },
      ],
    });
    scratchWidget.onKey!({ name: 'G' } as any, s, {} as any);
    expect(s.clipCursor).toBe(1);
    scratchWidget.onKey!({ name: 'g' } as any, s, {} as any);
    expect(s.clipCursor).toBe(0);
  });

  test('empty history → no movement', () => {
    const s: ScratchState = scratchWidget.initialState({ mode: 'clipboard' });
    const action = scratchWidget.onKey!({ name: 'j' } as any, s, {} as any);
    expect(action).toEqual({ type: 'none' });
  });
});

describe('scratch describe', () => {
  test('title row includes mode', () => {
    const s = scratchWidget.initialState({ mode: 'clipboard' });
    const desc = scratchWidget.describe!(s, ctxOf(), 0, 0);
    expect(desc).toContain('title row');
    expect(desc).toContain('clipboard');
  });

  test('preview body row reports line index', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'preview',
      previewLines: ['alpha', 'beta'],
    });
    const desc = scratchWidget.describe!(s, ctxOf(), 1, 0);
    expect(desc).toContain('line[0]');
    expect(desc).toContain('alpha');
  });

  test('memo body row reports memo line', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['first', 'second'],
    });
    const desc = scratchWidget.describe!(s, ctxOf(), 2, 0);
    expect(desc).toContain('line[1]');
    expect(desc).toContain('second');
  });

  test('clipboard body row reports entry id', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'clipboard',
      clipHistory: [{ id: 'xyz', text: 'abc' }],
    });
    const desc = scratchWidget.describe!(s, ctxOf(), 1, 0);
    expect(desc).toContain('xyz');
    expect(desc).toContain('abc');
  });
});

describe('scratch render — memo chrome flags (Arc M)', () => {
  test('memoShowHelp=true renders help header above memo body', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['hello'],
    });
    s.memoShowHelp = true;
    const out = scratchWidget.render(s, ctxOf({ height: 6, focused: true }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('type your note');
    expect(plain).toContain('Ctrl+S save');
    expect(plain).toContain('hello');
  });

  test('memoShowHelp unset (default) hides help header', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['hello'],
    });
    const out = scratchWidget.render(s, ctxOf({ height: 6, focused: true }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).not.toContain('type your note');
    expect(plain).toContain('hello');
  });

  test('memoCursorStyle=inverse paints \\x1b[7m cursor cell', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['abc'],
    });
    s.memoLineIdx = 0;
    s.memoColIdx = 1;
    s.memoCursorStyle = 'inverse';
    const out = scratchWidget.render(s, ctxOf({ height: 4, focused: true }), 'Scratch');
    const joined = out.join('\n');
    // Inverse-video ANSI: ESC [ 7 m … ESC [ 0 m around the cursor char.
    expect(joined).toContain('\x1b[7m');
    expect(joined).toContain('\x1b[0m');
  });

  test('memoCursorStyle=pipe (default) uses │ as cursor divider', () => {
    const s: ScratchState = scratchWidget.initialState({
      mode: 'memo',
      memoLines: ['abc'],
    });
    s.memoLineIdx = 0;
    s.memoColIdx = 1;
    // memoCursorStyle unset → 'pipe' default.
    const out = scratchWidget.render(s, ctxOf({ height: 4, focused: true }), 'Scratch');
    const plain = out.map(stripAnsi).join('\n');
    expect(plain).toContain('a│bc');
  });
});
