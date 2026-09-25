// ── OSC 11 terminal background query tests (Phase 3) ──
//
// Pure-function coverage. The interactive query path needs a real TTY
// so we exercise it only via the no-TTY short-circuit — the full
// round-trip is validated manually in a real terminal.

import { describe, test, expect } from 'bun:test';
import {
  parseOsc11Response,
  classifyBgMode,
  queryTerminalBg,
} from '../src/panes/terminal-bg-query';

describe('parseOsc11Response', () => {
  test('xterm 16-bit channels → 8-bit', () => {
    // `rgb:0000/0000/0000` = black
    expect(parseOsc11Response('\x1b]11;rgb:0000/0000/0000')).toEqual({ r: 0, g: 0, b: 0 });
    // `rgb:ffff/ffff/ffff` = white
    expect(parseOsc11Response('\x1b]11;rgb:ffff/ffff/ffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('8-bit channels are accepted too', () => {
    expect(parseOsc11Response('\x1b]11;rgb:00/00/00')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseOsc11Response('\x1b]11;rgb:ff/ff/ff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('Catppuccin Mocha base #1e1e2e round-trips within rounding', () => {
    // r=0x1e=30, g=0x1e=30, b=0x2e=46
    const parsed = parseOsc11Response('\x1b]11;rgb:1e1e/1e1e/2e2e');
    expect(parsed?.r).toBeGreaterThanOrEqual(29);
    expect(parsed?.r).toBeLessThanOrEqual(31);
    expect(parsed?.b).toBeGreaterThanOrEqual(45);
    expect(parsed?.b).toBeLessThanOrEqual(47);
  });

  test('malformed response → null', () => {
    expect(parseOsc11Response('not-an-osc')).toBeNull();
    expect(parseOsc11Response('\x1b]11;rgb:zzz/yyy/xxx')).toBeNull();
    expect(parseOsc11Response('\x1b]10;rgb:00/00/00')).toBeNull();  // OSC 10, not 11
  });
});

describe('classifyBgMode', () => {
  test('pure black → dark', () => {
    expect(classifyBgMode({ r: 0, g: 0, b: 0 })).toBe('dark');
  });

  test('pure white → light', () => {
    expect(classifyBgMode({ r: 255, g: 255, b: 255 })).toBe('light');
  });

  test('Catppuccin Mocha base (dark) → dark', () => {
    expect(classifyBgMode({ r: 30, g: 30, b: 46 })).toBe('dark');
  });

  test('Catppuccin Latte base (light) → light', () => {
    // #eff1f5
    expect(classifyBgMode({ r: 239, g: 241, b: 245 })).toBe('light');
  });

  test('mid-grey 50% → light (tie goes to non-dark)', () => {
    expect(classifyBgMode({ r: 128, g: 128, b: 128 })).toBe('light');
  });
});

describe('queryTerminalBg — no-TTY short-circuit', () => {
  test('returns no-tty reason when stdin is not a TTY', async () => {
    // Fake streams without isTTY — the bun-test environment already
    // has this property absent, but we pass explicit fakes so the
    // test is independent of harness behaviour.
    const fakeStdin = { isTTY: false } as unknown as NodeJS.ReadStream;
    const fakeStdout = { isTTY: false } as unknown as NodeJS.WriteStream;
    const r = await queryTerminalBg({ stdin: fakeStdin, stdout: fakeStdout, timeoutMs: 50 });
    expect(r.mode).toBeNull();
    expect(r.reason).toBe('no-tty');
  });
});
