import { describe, expect, test } from 'bun:test';

import { isTextInputQuitChord } from '../src/chat/input-quit-chord.js';

describe('isTextInputQuitChord', () => {
  test('matches Ctrl+Q / Ctrl+\\\\ variants including shift and Korean IME forms', () => {
    expect(isTextInputQuitChord({ name: 'q', ctrl: true, shift: false } as never)).toBe(true);
    expect(isTextInputQuitChord({ name: 'Q', ctrl: true, shift: true } as never)).toBe(true);
    expect(isTextInputQuitChord({ name: '\\', ctrl: true, shift: false } as never)).toBe(true);
    expect(isTextInputQuitChord({ name: 'backslash', ctrl: true, shift: false } as never)).toBe(true);
    expect(isTextInputQuitChord({ name: 'ㅂ', ctrl: true, shift: false } as never)).toBe(true);
    expect(isTextInputQuitChord({ name: 'ㅃ', ctrl: true, shift: false } as never)).toBe(true);
  });

  test('does not match non-ctrl or unrelated keys', () => {
    expect(isTextInputQuitChord({ name: 'q', ctrl: false, shift: false } as never)).toBe(false);
    expect(isTextInputQuitChord({ name: 'g', ctrl: true, shift: false } as never)).toBe(false);
  });
});
