import { describe, expect, test } from 'bun:test';

import { isXtermCapabilityResponse } from './xterm-capability-filter';

describe('isXtermCapabilityResponse', () => {
  describe('matches capability responses', () => {
    test('Primary DA — \\x1b[?62;4;9;22c (xterm.js default response)', () => {
      expect(isXtermCapabilityResponse('\x1b[?62;4;9;22c')).toBe(true);
    });

    test('Primary DA — \\x1b[?1;2c (VT100 with AVO)', () => {
      expect(isXtermCapabilityResponse('\x1b[?1;2c')).toBe(true);
    });

    test('Secondary DA — \\x1b[>0;276;0c (xterm.js version response)', () => {
      expect(isXtermCapabilityResponse('\x1b[>0;276;0c')).toBe(true);
    });

    test('Tertiary DA — \\x1b[=0c', () => {
      expect(isXtermCapabilityResponse('\x1b[=0c')).toBe(true);
    });

    test('DSR cursor position — \\x1b[12;34R', () => {
      expect(isXtermCapabilityResponse('\x1b[12;34R')).toBe(true);
    });

    test('DSR cursor position — \\x1b[1;1R (top-left)', () => {
      expect(isXtermCapabilityResponse('\x1b[1;1R')).toBe(true);
    });

    test('DSR status OK — \\x1b[0n', () => {
      expect(isXtermCapabilityResponse('\x1b[0n')).toBe(true);
    });

    test('OSC color reply — \\x1b]11;rgb:1c1c/1c1c/1c1c\\x07 (BEL term)', () => {
      expect(isXtermCapabilityResponse('\x1b]11;rgb:1c1c/1c1c/1c1c\x07')).toBe(true);
    });

    test('OSC color reply — \\x1b]11;rgb:0/0/0\\x1b\\\\ (ST term)', () => {
      expect(isXtermCapabilityResponse('\x1b]11;rgb:0/0/0\x1b\\')).toBe(true);
    });

    test('XTWINOPS reply — \\x1b[6;13;7t (window pixel size)', () => {
      expect(isXtermCapabilityResponse('\x1b[6;13;7t')).toBe(true);
    });

    test('DECRPM private mode report — \\x1b[?1004;1$y', () => {
      expect(isXtermCapabilityResponse('\x1b[?1004;1$y')).toBe(true);
    });
  });

  describe('does NOT match user keystrokes / inputs', () => {
    test('plain printable char', () => {
      expect(isXtermCapabilityResponse('a')).toBe(false);
      expect(isXtermCapabilityResponse('Hello')).toBe(false);
      expect(isXtermCapabilityResponse(' ')).toBe(false);
    });

    test('control chars (Ctrl-A, Ctrl-Z, …)', () => {
      expect(isXtermCapabilityResponse('\x01')).toBe(false); // Ctrl-A
      expect(isXtermCapabilityResponse('\x1a')).toBe(false); // Ctrl-Z
      expect(isXtermCapabilityResponse('\x03')).toBe(false); // Ctrl-C
    });

    test('Enter, Tab, Backspace', () => {
      expect(isXtermCapabilityResponse('\r')).toBe(false);
      expect(isXtermCapabilityResponse('\n')).toBe(false);
      expect(isXtermCapabilityResponse('\t')).toBe(false);
      expect(isXtermCapabilityResponse('\x7f')).toBe(false); // DEL
    });

    test('Escape alone', () => {
      expect(isXtermCapabilityResponse('\x1b')).toBe(false);
    });

    test('Arrow keys (CSI letter)', () => {
      expect(isXtermCapabilityResponse('\x1b[A')).toBe(false); // Up
      expect(isXtermCapabilityResponse('\x1b[B')).toBe(false); // Down
      expect(isXtermCapabilityResponse('\x1b[C')).toBe(false); // Right
      expect(isXtermCapabilityResponse('\x1b[D')).toBe(false); // Left
    });

    test('PageUp / PageDown / Home / End / Insert / Delete (CSI ~ form)', () => {
      expect(isXtermCapabilityResponse('\x1b[5~')).toBe(false); // PgUp
      expect(isXtermCapabilityResponse('\x1b[6~')).toBe(false); // PgDn
      expect(isXtermCapabilityResponse('\x1b[1~')).toBe(false); // Home
      expect(isXtermCapabilityResponse('\x1b[4~')).toBe(false); // End
      expect(isXtermCapabilityResponse('\x1b[2~')).toBe(false); // Insert
      expect(isXtermCapabilityResponse('\x1b[3~')).toBe(false); // Delete
    });

    test('F-keys application mode (SS3 form)', () => {
      expect(isXtermCapabilityResponse('\x1bOP')).toBe(false); // F1
      expect(isXtermCapabilityResponse('\x1bOQ')).toBe(false); // F2
      expect(isXtermCapabilityResponse('\x1bOR')).toBe(false); // F3
      expect(isXtermCapabilityResponse('\x1bOS')).toBe(false); // F4
    });

    test('F-keys CSI form (F5+)', () => {
      expect(isXtermCapabilityResponse('\x1b[15~')).toBe(false); // F5
      expect(isXtermCapabilityResponse('\x1b[17~')).toBe(false); // F6
      expect(isXtermCapabilityResponse('\x1b[24~')).toBe(false); // F12
    });

    test('Modifier+arrow (Shift+Up etc — CSI 1;n letter)', () => {
      expect(isXtermCapabilityResponse('\x1b[1;2A')).toBe(false); // Shift+Up
      expect(isXtermCapabilityResponse('\x1b[1;3A')).toBe(false); // Alt+Up
      expect(isXtermCapabilityResponse('\x1b[1;5A')).toBe(false); // Ctrl+Up
    });

    test('Alt+letter (Esc + char)', () => {
      expect(isXtermCapabilityResponse('\x1ba')).toBe(false); // Alt-a
      expect(isXtermCapabilityResponse('\x1bz')).toBe(false); // Alt-z
    });

    test('bracketed paste boundaries', () => {
      expect(isXtermCapabilityResponse('\x1b[200~')).toBe(false); // begin
      expect(isXtermCapabilityResponse('\x1b[201~')).toBe(false); // end
    });

    test('multi-char paste payload', () => {
      expect(isXtermCapabilityResponse('Hello, World!\n')).toBe(false);
      expect(isXtermCapabilityResponse('  echo "hi"\n')).toBe(false);
    });

    test('focus events sent to PTY (DECSET 1004 emits, but we treat as input)', () => {
      // xterm.js can emit \x1b[I (focus in) / \x1b[O (focus out) when
      // the child has DECSET 1004 active. These look like CSI letter,
      // not the "?> = $" prefix our filter targets — they pass through
      // and get forwarded to the child, which is correct.
      expect(isXtermCapabilityResponse('\x1b[I')).toBe(false);
      expect(isXtermCapabilityResponse('\x1b[O')).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('empty string', () => {
      expect(isXtermCapabilityResponse('')).toBe(false);
    });

    test('single ESC (no payload)', () => {
      expect(isXtermCapabilityResponse('\x1b')).toBe(false);
    });

    test('long but non-matching escape', () => {
      expect(isXtermCapabilityResponse('\x1b[999;999H')).toBe(false); // CUP
      expect(isXtermCapabilityResponse('\x1b[2J')).toBe(false); // ED
      expect(isXtermCapabilityResponse('\x1b[?25h')).toBe(true); // matches private CSI letter form
    });

    test('truncated DA response (no terminator)', () => {
      // We don't try to handle partial chunks — xterm.js emits whole
      // responses in one onData call.
      expect(isXtermCapabilityResponse('\x1b[?62;4;9;22')).toBe(false);
    });
  });
});
