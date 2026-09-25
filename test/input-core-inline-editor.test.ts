import { describe, expect, test } from 'bun:test';

import {
  createInlineEditorState,
  inlineEditorBackspace,
  inlineEditorClear,
  inlineEditorCutToEnd,
  inlineEditorDelete,
  inlineEditorDeleteWordBackward,
  inlineEditorInsert,
  inlineEditorMoveEnd,
  inlineEditorMoveHome,
  inlineEditorMoveLeft,
  inlineEditorMoveRight,
  inlineEditorSeekWordBoundary,
} from '../src/input-core/inline-editor.js';

describe('inline-editor', () => {
  test('insert respects cursor position', () => {
    const state = { text: 'ac', cursor: 1 };
    expect(inlineEditorInsert(state, 'b')).toEqual({ text: 'abc', cursor: 2 });
  });

  test('backspace and delete remove around the cursor', () => {
    expect(inlineEditorBackspace({ text: 'abc', cursor: 2 })).toEqual({ text: 'ac', cursor: 1 });
    expect(inlineEditorDelete({ text: 'abc', cursor: 1 })).toEqual({ text: 'ac', cursor: 1 });
  });

  test('move helpers clamp to bounds', () => {
    expect(inlineEditorMoveLeft({ text: 'abc', cursor: 0 }).cursor).toBe(0);
    expect(inlineEditorMoveRight({ text: 'abc', cursor: 3 }).cursor).toBe(3);
    expect(inlineEditorMoveHome({ text: 'abc', cursor: 2 }).cursor).toBe(0);
    expect(inlineEditorMoveEnd({ text: 'abc', cursor: 1 }).cursor).toBe(3);
  });

  test('clear and cut-to-end preserve valid cursor state', () => {
    expect(inlineEditorClear({ text: 'abc', cursor: 2 })).toEqual({ text: '', cursor: 0 });
    expect(inlineEditorCutToEnd({ text: 'abc', cursor: 1 })).toEqual({ text: 'a', cursor: 1 });
  });

  test('delete-word-backward uses shared word-boundary rules', () => {
    expect(inlineEditorDeleteWordBackward({ text: 'git status --porcelain', cursor: 22 })).toEqual({
      text: 'git status ',
      cursor: 11,
    });
  });

  test('word-boundary seek mirrors shell-like navigation', () => {
    expect(inlineEditorSeekWordBoundary('one two three', 13, -1)).toBe(8);
    expect(inlineEditorSeekWordBoundary('one two three', 8, -1)).toBe(4);
    expect(inlineEditorSeekWordBoundary('one two three', 0, 1)).toBe(4);
  });

  test('createInlineEditorState starts at end of seed text', () => {
    expect(createInlineEditorState('hello')).toEqual({ text: 'hello', cursor: 5 });
  });
});
