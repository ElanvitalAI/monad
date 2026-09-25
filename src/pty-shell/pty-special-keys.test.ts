import { describe, expect, test } from 'bun:test';
import { resolvePtySpecialKey } from './pty-special-keys.js';

const EXPECTED_SPECIAL_KEY_BYTES = {
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  delete: '\x1b[3~',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
} as const;

describe('PTY special key SSOT', () => {
  test('resolves all canonical names to their exact ANSI bytes', () => {
    for (const [name, bytes] of Object.entries(EXPECTED_SPECIAL_KEY_BYTES)) {
      expect(resolvePtySpecialKey(name)).toBe(bytes);
    }
  });

  test('resolves normalized escape alias to the exact canonical ESC byte', () => {
    expect(resolvePtySpecialKey(' escape ')).toBe('\x1b');
    expect(resolvePtySpecialKey('ESC')).toBe('\x1b');
    expect(resolvePtySpecialKey('escape')).toBe(resolvePtySpecialKey('esc'));
  });

  test('rejects unknown names with available names', () => {
    expect(() => resolvePtySpecialKey('launch-missiles')).toThrow('unknown PTY special key: launch-missiles; available names:');
    expect(() => resolvePtySpecialKey('launch-missiles')).toThrow('escape');
    expect(() => resolvePtySpecialKey('launch-missiles')).toThrow('esc');
  });
});
