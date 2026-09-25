import { describe, expect, test } from 'bun:test';
import { appendInputText, backspaceInputText, textFromInputKey } from '../../src/input/text-key.js';
import type { Key } from '../../src/tui.js';

function key(name: string, extra: Partial<Key> = {}): Key {
  return { name, ctrl: false, shift: false, ...extra };
}

describe('input text key helpers', () => {
  test('backspaceInputText removes one trailing character', () => {
    expect(backspaceInputText('abc')).toBe('ab');
    expect(backspaceInputText('')).toBe('');
  });

  test('appendInputText appends text and respects optional maxLength', () => {
    expect(appendInputText('ab', 'c')).toBe('abc');
    expect(appendInputText('ab', 'c', 2)).toBe('ab');
    expect(appendInputText('ab', 'c', 3)).toBe('abc');
  });

  test('textFromInputKey extracts printable chars and optional space', () => {
    expect(textFromInputKey(key('a'))).toBe('a');
    expect(textFromInputKey(key('space'))).toBeNull();
    expect(textFromInputKey(key('space'), { allowSpace: true })).toBe(' ');
  });

  test('textFromInputKey respects blocked names and allowed pattern', () => {
    expect(textFromInputKey(key('down'))).toBeNull();
    expect(textFromInputKey(key(':'), { allowPattern: /^[0-9:]$/ })).toBe(':');
    expect(textFromInputKey(key('x'), { allowPattern: /^[0-9:]$/ })).toBeNull();
  });

  test('textFromInputKey ignores ctrl/alt modified keys', () => {
    expect(textFromInputKey(key('a', { ctrl: true }))).toBeNull();
    expect(textFromInputKey(key('a', { alt: true }))).toBeNull();
  });
});
