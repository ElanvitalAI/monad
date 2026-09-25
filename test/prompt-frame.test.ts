import { describe, expect, test } from 'bun:test';

import { visibleWidth } from '../src/tui.js';
import {
  buildPromptFrameFromPromptBottomRow,
  bottomFixedRowsForPromptFrame,
  clampPromptInputHeight,
  fallbackPromptFrame,
  firstVisibleInputLineIdx,
  inputLineWindow,
  resolvePromptFrame,
} from '../src/display/prompt-frame.js';

describe('prompt-frame geometry', () => {
  test('clamps visible input lines to 1..8 by default', () => {
    expect(clampPromptInputHeight(0)).toBe(1);
    expect(clampPromptInputHeight(3)).toBe(3);
    expect(clampPromptInputHeight(99)).toBe(8);
  });

  test('builds divider and prompt rows from prompt bottom row', () => {
    expect(buildPromptFrameFromPromptBottomRow(20, 3)).toEqual({
      inputHeight: 3,
      promptTopRow: 18,
      promptBottomRow: 20,
      topDividerRow: 17,
      bottomDividerRow: 21,
    });
  });

  test('bottom fixed rows tracks prompt frame height', () => {
    expect(bottomFixedRowsForPromptFrame(1)).toBe(8);
    expect(bottomFixedRowsForPromptFrame(4)).toBe(11);
  });

  test('fallback frame uses the legacy prompt-bottom fallback row', () => {
    expect(fallbackPromptFrame(30, 2)).toEqual({
      inputHeight: 2,
      promptTopRow: 23,
      promptBottomRow: 24,
      topDividerRow: 22,
      bottomDividerRow: 25,
    });
  });

  describe('inputLineWindow — display-width horizontal input window', () => {
    test('preserves a short line and its cursor column', () => {
      expect(inputLineWindow('hello', 5, 157)).toEqual({ display: 'hello', cursorCol: 5 });
    });

    test('keeps an ASCII window at the cursor when the cursor is at the front', () => {
      expect(inputLineWindow('a'.repeat(300), 0, 100)).toEqual({
        display: 'a'.repeat(100),
        cursorCol: 0,
      });
    });

    test('keeps the widest Korean tail and end cursor within the display width', () => {
      const window = inputLineWindow('가'.repeat(100), 100, 157);
      expect(visibleWidth(window.display)).toBeLessThanOrEqual(157);
      expect(window.cursorCol).toBeLessThanOrEqual(157);
      expect(window.display).toBe('가'.repeat(78));
      expect(window.cursorCol).toBe(156);
    });

    test('never splits surrogate pairs or wide characters at a window boundary', () => {
      const text = `😀${'가'.repeat(4)}`;
      const front = inputLineWindow(text, 0, 4);
      const tail = inputLineWindow(text, text.length, 4);
      expect(front).toEqual({ display: '😀가', cursorCol: 0 });
      expect(tail).toEqual({ display: '가가', cursorCol: 4 });
      expect(visibleWidth(front.display)).toBeLessThanOrEqual(4);
      expect(visibleWidth(tail.display)).toBeLessThanOrEqual(4);
    });
  });

  describe('firstVisibleInputLineIdx — scroll window for multi-line input', () => {
    // Cursor must always sit inside the visible window. Regression
    // anchor for the bug where pasting >maxLines lines left bottom
    // rows rendered nowhere and backspace looked broken.
    test('buffer fits within window — no scroll', () => {
      // 3 lines, 8-line window, cursor anywhere → top of buffer visible
      expect(firstVisibleInputLineIdx(3, 3, 0)).toBe(0);
      expect(firstVisibleInputLineIdx(3, 3, 2)).toBe(0);
    });

    test('paste of 10 lines into 8-line window — cursor at end pins to bottom', () => {
      // Cursor on lines[9]; window shows lines[2..9].
      expect(firstVisibleInputLineIdx(10, 8, 9)).toBe(2);
    });

    test('cursor moved up to line 5 with 10-line buffer — window scrolls up', () => {
      // Cursor visible inside [0..7].
      expect(firstVisibleInputLineIdx(10, 8, 5)).toBe(0);
    });

    test('cursor at line 8 of 10 — window shifts so cursor is bottom row', () => {
      // 8 - 8 + 1 = 1 → window shows [1..8], cursor on bottom row.
      expect(firstVisibleInputLineIdx(10, 8, 8)).toBe(1);
    });

    test('cursor at line 0 of 10 — window pinned to top of buffer', () => {
      expect(firstVisibleInputLineIdx(10, 8, 0)).toBe(0);
    });

    test('exactly maxLines in buffer — never scrolls', () => {
      expect(firstVisibleInputLineIdx(8, 8, 0)).toBe(0);
      expect(firstVisibleInputLineIdx(8, 8, 7)).toBe(0);
    });
  });

  test('resolvePromptFrame prefers composed zone rows when present', () => {
    const zoneRows = new Map<string, { start: number; height: number }>([
      ['input-prompt', { start: 40, height: 3 }],
    ]);
    expect(resolvePromptFrame(60, 1, zoneRows)).toEqual({
      inputHeight: 3,
      promptTopRow: 40,
      promptBottomRow: 42,
      topDividerRow: 39,
      bottomDividerRow: 43,
    });
  });
});
