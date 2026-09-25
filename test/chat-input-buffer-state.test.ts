import { describe, expect, test } from 'bun:test';

import {
  applyCurrentLineEditorState,
  applyMultilineEditorState,
  currentLineEditorState,
  insertMultilineTextAtCursor,
  insertTextAtCursor,
  multilineEditorState,
  type TextInputBufferState,
} from '../src/chat/input-buffer-state.js';

describe('chat input-buffer-state helpers', () => {
  test('current-line editor projection round-trips through apply', () => {
    const state: TextInputBufferState = { lines: ['hello', 'world'], lineIdx: 1, colIdx: 3 };
    expect(currentLineEditorState(state)).toEqual({ text: 'world', cursor: 3 });
    expect(applyCurrentLineEditorState(state, { text: 'wide', cursor: 2 })).toEqual({
      lines: ['hello', 'wide'],
      lineIdx: 1,
      colIdx: 2,
    });
  });

  test('multiline projection round-trips through apply', () => {
    const state: TextInputBufferState = { lines: ['a', 'bb'], lineIdx: 1, colIdx: 1 };
    expect(multilineEditorState(state)).toEqual({ lines: ['a', 'bb'], line: 1, col: 1 });
    expect(applyMultilineEditorState({ lines: ['ab'], line: 0, col: 2 })).toEqual({
      lines: ['ab'],
      lineIdx: 0,
      colIdx: 2,
    });
  });

  test('insertTextAtCursor splices text into the active line', () => {
    expect(insertTextAtCursor(
      { lines: ['ab', 'cd'], lineIdx: 0, colIdx: 1 },
      'XY',
    )).toEqual({
      lines: ['aXYb', 'cd'],
      lineIdx: 0,
      colIdx: 3,
    });
  });

  test('inserts multiline pasted text as buffer lines without submitting', () => {
    expect(insertMultilineTextAtCursor(
      { lines: ['left-right'], lineIdx: 0, colIdx: 5 },
      'L1\nL2',
    )).toEqual({
      lines: ['left-L1', 'L2right'],
      lineIdx: 1,
      colIdx: 2,
    });
  });

  test('preserves text right of single-line paste at start, middle, and end cursors', () => {
    expect(insertMultilineTextAtCursor(
      { lines: ['right'], lineIdx: 0, colIdx: 0 },
      'ABC',
    )).toEqual({ lines: ['ABCright'], lineIdx: 0, colIdx: 3 });

    expect(insertMultilineTextAtCursor(
      { lines: ['left-right'], lineIdx: 0, colIdx: 5 },
      'ABC',
    )).toEqual({ lines: ['left-ABCright'], lineIdx: 0, colIdx: 8 });

    expect(insertMultilineTextAtCursor(
      { lines: ['left'], lineIdx: 0, colIdx: 4 },
      'ABC',
    )).toEqual({ lines: ['leftABC'], lineIdx: 0, colIdx: 7 });
  });
});
