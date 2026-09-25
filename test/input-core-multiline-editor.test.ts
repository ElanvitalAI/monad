import { describe, expect, test } from 'bun:test';

import {
  multilineEditorBackspace,
  multilineEditorInsertLineBreak,
  multilineEditorMoveLeft,
  multilineEditorMoveRight,
  multilineEditorMoveVertical,
} from '../src/input-core/multiline-editor.js';

describe('multiline-editor', () => {
  test('insertLineBreak splits the current line at the cursor', () => {
    expect(multilineEditorInsertLineBreak({
      lines: ['hello world'],
      line: 0,
      col: 5,
    })).toEqual({
      lines: ['hello', ' world'],
      line: 1,
      col: 0,
    });
  });

  test('backspace deletes within a line and merges across lines', () => {
    expect(multilineEditorBackspace({
      lines: ['abc'],
      line: 0,
      col: 2,
    })).toEqual({
      lines: ['ac'],
      line: 0,
      col: 1,
    });

    expect(multilineEditorBackspace({
      lines: ['abc', 'def'],
      line: 1,
      col: 0,
    })).toEqual({
      lines: ['abcdef'],
      line: 0,
      col: 3,
    });
  });

  test('left/right move across line boundaries', () => {
    expect(multilineEditorMoveLeft({
      lines: ['abc', 'def'],
      line: 1,
      col: 0,
    })).toEqual({
      lines: ['abc', 'def'],
      line: 0,
      col: 3,
    });

    expect(multilineEditorMoveRight({
      lines: ['abc', 'def'],
      line: 0,
      col: 3,
    })).toEqual({
      lines: ['abc', 'def'],
      line: 1,
      col: 0,
    });
  });

  test('vertical movement clamps by target line length', () => {
    expect(multilineEditorMoveVertical({
      lines: ['abcd', 'xy'],
      line: 0,
      col: 4,
    }, 1)).toEqual({
      lines: ['abcd', 'xy'],
      line: 1,
      col: 2,
    });
  });
});
