import { describe, expect, test } from 'bun:test';
import { resolvePtySpecialKey } from '../src/pty-shell/pty-special-keys.js';

describe('PTY special keys', () => {
  // The name says "every", so sweep every letter × every spelling rather
  // than sampling three — a sampled test can pass while a range boundary
  // (a → 0x01, z → 0x1a) is off by one.
  test('maps every Ctrl-letter spelling to its ASCII control byte', () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i);
      const expected = String.fromCharCode(i + 1);
      for (const spelling of [`ctrl+${letter}`, `control+${letter}`, `^${letter}`]) {
        expect(resolvePtySpecialKey(spelling)).toBe(expected);
      }
    }
    expect(resolvePtySpecialKey('CTRL+C')).toBe('\x03');
    expect(resolvePtySpecialKey('  ctrl+c  ')).toBe('\x03');
  });

  // Rejection is a contract, not an accident: an unknown name must throw
  // loudly rather than resolve to an empty or arbitrary byte.
  test('rejects malformed control-key spellings loudly', () => {
    for (const bad of ['ctrl+', 'ctrl+1', 'ctrl+cc', 'ctrl++c', '^', '^1', 'ctrl c', 'meta+c']) {
      expect(() => resolvePtySpecialKey(bad)).toThrow(/unknown PTY special key/);
    }
  });

  test('keeps existing terminal keys available', () => {
    expect(resolvePtySpecialKey('enter')).toBe('\r');
    expect(resolvePtySpecialKey('escape')).toBe('\x1b');
  });
});
