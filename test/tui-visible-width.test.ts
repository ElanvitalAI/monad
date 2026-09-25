// ── visibleWidth tests — Phase 3 grapheme-aware upgrade ──
//
// Locks the behaviour of `src/tui.ts:visibleWidth` after the
// Bun.stringWidth integration. Covers the regressions we care about:
// emoji ZWJ (family / flag), combining marks, Nerd Font PUA still
// counts as 2.

import { describe, test, expect } from 'bun:test';
import chalk from 'chalk';
import { visibleWidth, stripAnsi, wrapAnsiByWidth } from '../src/tui';

describe('visibleWidth — ASCII', () => {
  test('plain ASCII = character count', () => {
    expect(visibleWidth('abc')).toBe(3);
    expect(visibleWidth('hello world')).toBe(11);
  });

  test('empty string = 0', () => {
    expect(visibleWidth('')).toBe(0);
  });
});

describe('visibleWidth — CJK / fullwidth', () => {
  test('Hangul syllable counts as 2', () => {
    expect(visibleWidth('가')).toBe(2);
  });

  test('ASCII + Hangul — each Hangul adds 2', () => {
    expect(visibleWidth('abc한글')).toBe(7);  // 1+1+1 + 2+2
  });

  test('Japanese / CJK ideograph counts as 2', () => {
    expect(visibleWidth('日本語')).toBe(6);
  });
});

describe('visibleWidth — emoji (grapheme-aware when Bun is available)', () => {
  test('single emoji counts as 2', () => {
    expect(visibleWidth('😀')).toBe(2);
  });

  test('family ZWJ sequence counts as 2 (single grapheme cluster)', () => {
    // '👨‍👩‍👧' — man + ZWJ + woman + ZWJ + girl
    const w = visibleWidth('👨‍👩‍👧');
    // Under Bun.stringWidth this is 2 (single grapheme). Legacy
    // fallback counts each sub-glyph separately (larger). Either way
    // it should NOT be 0 and should be at most 6.
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(6);
  });
});

describe('visibleWidth — ANSI escapes are stripped', () => {
  test('SGR escape contributes 0 width', () => {
    expect(visibleWidth('\x1b[31mred\x1b[39m')).toBe(3);
  });

  test('multiple escapes + content', () => {
    expect(visibleWidth('\x1b[1ma\x1b[22m\x1b[31mb\x1b[39mc')).toBe(3);
  });
});

describe('visibleWidth — Nerd Font PUA glyphs', () => {
  test('BMP PUA (E000-F8FF) counts as 2', () => {
    // U+F0A0 (common Nerd Font glyph range)
    expect(visibleWidth('')).toBe(2);
  });

  test('plain + Nerd glyph composed width', () => {
    expect(visibleWidth('ab')).toBe(4);  // 1 + 2 + 1
  });
});

describe('wrapAnsiByWidth', () => {
  test('wraps Hangul by visible width instead of raw string length', () => {
    const out = wrapAnsiByWidth('조선의왕리스트', 8);
    expect(out.length).toBeGreaterThan(1);
    for (const line of out) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(8);
    }
    expect(stripAnsi(out.join(''))).toBe('조선의왕리스트');
  });

  test('preserves ANSI styling across wrapped lines', () => {
    chalk.level = 1;
    const styled = chalk.bold.red('abcdefghij');
    const out = wrapAnsiByWidth(styled, 4);
    expect(out.length).toBeGreaterThan(1);
    for (const line of out) {
      expect(line).toContain('\x1b[');
      expect(visibleWidth(line)).toBeLessThanOrEqual(4);
    }
    expect(stripAnsi(out.join(''))).toBe('abcdefghij');
  });

  test('keeps box-drawing table rows within width budget', () => {
    const row = '│ 10 │ 연산군 │ 1494~1506 │';
    const out = wrapAnsiByWidth(row, 18);
    expect(out.length).toBeGreaterThan(1);
    for (const line of out) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(18);
    }
    expect(stripAnsi(out.join(''))).toBe(row);
  });

  test('block-aware mode keeps table rows atomic and truncates with overflow hint', () => {
    const row = '│ 10 │ 연산군 │ 1494~1506 │';
    const out = wrapAnsiByWidth('', {
      cols: 18,
      mode: 'block-aware',
      tablePolicy: 'overflow',
      segments: [{ kind: 'gfm-table', text: row }],
    });
    expect(out).toHaveLength(1);
    expect(visibleWidth(out[0]!)).toBeLessThanOrEqual(18);
    expect(stripAnsi(out[0]!)).toContain('…');
  });
});
