// Cursor-state helper tests. P2.2.a: byte-identity to the prior
// chat.ts inline writes is the contract — these tests pin down the
// exact escape sequences produced so future refactors (P2.2.b/c)
// can prove they don't drift.

import { describe, expect, test } from 'bun:test';

import {
  paintCursor,
  paintCursorMove,
  paintCursorVisibility,
  type CursorState,
} from '../src/display/cursor-state.js';

const CSI = '\x1b[';

describe('paintCursorMove', () => {
  test('emits CSI row;col H — byte-identical to ansi.moveTo', () => {
    expect(paintCursorMove(5, 12)).toBe(`${CSI}5;12H`);
    expect(paintCursorMove(1, 1)).toBe(`${CSI}1;1H`);
  });

  test('does not include any visibility escapes', () => {
    const out = paintCursorMove(10, 20);
    expect(out).not.toContain('?25');
  });

  test('passes coords through verbatim — no normalization', () => {
    expect(paintCursorMove(0, 0)).toBe(`${CSI}0;0H`);
    expect(paintCursorMove(999, 999)).toBe(`${CSI}999;999H`);
  });
});

describe('paintCursorVisibility', () => {
  test('true → CSI ?25 h', () => {
    expect(paintCursorVisibility(true)).toBe(`${CSI}?25h`);
  });

  test('false → CSI ?25 l', () => {
    expect(paintCursorVisibility(false)).toBe(`${CSI}?25l`);
  });
});

describe('paintCursor (combined)', () => {
  test('null → hide only', () => {
    expect(paintCursor(null)).toBe(`${CSI}?25l`);
  });

  test('visible:false → hide only (no move)', () => {
    const state: CursorState = { row: 5, col: 5, visible: false };
    expect(paintCursor(state)).toBe(`${CSI}?25l`);
  });

  test('visible:true → move + show', () => {
    const state: CursorState = { row: 7, col: 14, visible: true };
    expect(paintCursor(state)).toBe(`${CSI}7;14H${CSI}?25h`);
  });

  test('move precedes show in the combined output', () => {
    const out = paintCursor({ row: 1, col: 1, visible: true });
    const moveIdx = out.indexOf(`${CSI}1;1H`);
    const showIdx = out.indexOf(`${CSI}?25h`);
    expect(moveIdx).toBeGreaterThanOrEqual(0);
    expect(showIdx).toBeGreaterThan(moveIdx);
  });
});

describe('parity with chat.ts pre-refactor escapes', () => {
  // Sanity-check the EXACT byte sequences chat.ts used to emit
  // before P2.2.a, so a future grep for '\x1b[?25' regression
  // shows whether the helper or a stray literal added it.

  test('init show-cursor sequence prefix matches', () => {
    // Pre-P2.2.a: '\x1b[?25h\x1b[>1u\x1b[>4;2m'
    // Post-P2.2.a: paintCursorVisibility(true) + '\x1b[>1u\x1b[>4;2m'
    const composed = paintCursorVisibility(true) + '\x1b[>1u\x1b[>4;2m';
    expect(composed).toBe('\x1b[?25h\x1b[>1u\x1b[>4;2m');
  });

  test('exit hide-cursor sequence prefix matches', () => {
    // Pre-P2.2.a: '\x1b[?25l\x1b[<u\x1b[>4;0m' (×7 sites)
    // Post-P2.2.a: paintCursorVisibility(false) + '\x1b[<u\x1b[>4;0m'
    const composed = paintCursorVisibility(false) + '\x1b[<u\x1b[>4;0m';
    expect(composed).toBe('\x1b[?25l\x1b[<u\x1b[>4;0m');
  });

  test('cursor placement sequence matches ansi.moveTo output', () => {
    // Pre-P2.2.a: ansi.moveTo(curR, curX)  → CSI r;c H
    // Post-P2.2.a: paintCursorMove(curR, curX)
    expect(paintCursorMove(8, 3)).toBe('\x1b[8;3H');
  });
});
