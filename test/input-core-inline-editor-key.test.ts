import { describe, expect, test } from 'bun:test';

import { applyInlineEditorKey } from '../src/input-core/inline-editor-key.js';

describe('applyInlineEditorKey', () => {
  test('maps text entry and navigation into editor mutations', () => {
    expect(applyInlineEditorKey({ text: '', cursor: 0 }, { name: '가' })).toEqual({ text: '가', cursor: 1 });
    expect(applyInlineEditorKey({ text: 'ab', cursor: 1 }, { name: 'left' })).toEqual({ text: 'ab', cursor: 0 });
    expect(applyInlineEditorKey({ text: 'ab', cursor: 1 }, { name: 'right' })).toEqual({ text: 'ab', cursor: 2 });
  });

  test('handles readline-style control edits', () => {
    expect(applyInlineEditorKey({ text: 'abc', cursor: 2 }, { name: 'k', ctrl: true })).toEqual({ text: 'ab', cursor: 2 });
    expect(applyInlineEditorKey({ text: 'git status', cursor: 10 }, { name: 'w', ctrl: true })).toEqual({ text: 'git ', cursor: 4 });
    expect(applyInlineEditorKey({ text: 'abc', cursor: 2 }, { name: 'u', ctrl: true })).toEqual({ text: '', cursor: 0 });
  });

  test('supports shift-enter newline only when requested', () => {
    expect(applyInlineEditorKey({ text: 'ab', cursor: 1 }, { name: 'enter', shift: true })).toBeNull();
    expect(applyInlineEditorKey(
      { text: 'ab', cursor: 1 },
      { name: 'enter', shift: true },
      { shiftEnter: 'newline' },
    )).toEqual({ text: 'a\nb', cursor: 2 });
  });

  test('supports caller-defined tab insertion', () => {
    expect(applyInlineEditorKey(
      { text: 'ab', cursor: 1 },
      { name: 'tab' },
      { tab: '  ' },
    )).toEqual({ text: 'a  b', cursor: 3 });
  });
});
