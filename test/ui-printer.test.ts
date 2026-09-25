import { describe, expect, test } from 'bun:test';
import { Printer, cellWidth, isWide } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';

describe('LC3 Printer', () => {
  test('blank printer renders spaces padded to width', () => {
    const p = Printer.create({ width: 5, height: 2 });
    const lines = p.lines();
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('     ');
    expect(lines[1]).toBe('     ');
  });

  test('text is placed at (x, y) inside bounds', () => {
    const p = Printer.create({ width: 10, height: 3 });
    p.text(2, 1, 'hello');
    expect(stripAnsi(p.lines()[1]!)).toBe('  hello   ');
  });

  test('text overflow is clipped automatically, no bleed past width', () => {
    const p = Printer.create({ width: 6, height: 1 });
    p.text(3, 0, 'hello world');
    // Only "hel" (first 3 chars after x=3 within width 6) fits.
    expect(stripAnsi(p.lines()[0]!)).toBe('   hel');
  });

  test('text at negative x is clipped on the left', () => {
    const p = Printer.create({ width: 6, height: 1 });
    p.text(-2, 0, 'hello');
    // 'h' at x=-2 and 'e' at x=-1 drop; 'l','l','o' land at x=0..2.
    expect(stripAnsi(p.lines()[0]!)).toBe('llo   ');
  });

  test('text outside height is no-op', () => {
    const p = Printer.create({ width: 5, height: 2 });
    p.text(0, 5, 'nope');
    p.text(0, -1, 'nope');
    expect(stripAnsi(p.lines()[0]!)).toBe('     ');
    expect(stripAnsi(p.lines()[1]!)).toBe('     ');
  });

  test('sub printer clips child writes to its region', () => {
    const p = Printer.create({ width: 10, height: 3 });
    const child = p.sub(2, 1, 4, 1);
    child.text(0, 0, 'hello');       // only 4 cells fit
    child.text(0, 1, 'ignored');     // y=1 is outside child's h=1
    child.text(-1, 0, 'X');          // negative — ignored
    expect(stripAnsi(p.lines()[1]!)).toBe('  hell    ');
  });

  test('sub printer sub-of-sub composes offsets', () => {
    const p = Printer.create({ width: 12, height: 2 });
    const a = p.sub(1, 0, 10, 2);
    const b = a.sub(2, 1, 6, 1);
    b.text(0, 0, 'hi');
    // Final position: p.x = 1 + 2 = 3, p.y = 0 + 1 = 1
    expect(stripAnsi(p.lines()[1]!)).toBe('   hi       ');
  });

  test('wide chars (CJK) take 2 cells, clip correctly', () => {
    const p = Printer.create({ width: 6, height: 1 });
    p.text(0, 0, '안녕');  // Hangul = 2 + 2 = 4 cells
    expect(cellWidth('안녕')).toBe(4);
    const line = stripAnsi(p.lines()[0]!);
    // Line = "안녕" + 2 space padding
    expect(line.length).toBeGreaterThanOrEqual(4);
    expect(line.startsWith('안녕')).toBe(true);
  });

  test('wide char that would cross the right edge is dropped', () => {
    const p = Printer.create({ width: 3, height: 1 });
    p.text(2, 0, '안'); // would occupy cols 2..3 — col 3 is out of range
    // Wide char dropped entirely; result is 3 spaces.
    expect(stripAnsi(p.lines()[0]!)).toBe('   ');
  });

  test('ANSI SGR is preserved and does not count toward width', () => {
    const p = Printer.create({ width: 10, height: 1 });
    p.text(0, 0, '\x1b[1;31mred\x1b[0m x');
    const line = p.lines()[0]!;
    // Contains the red SGR before 'red' and reset before the space / 'x'.
    expect(line).toContain('\x1b[1;31m');
    expect(line).toContain('red');
    expect(line).toContain('x');
    // Visible width of the emitted line clips to 10.
    expect(cellWidth(line)).toBe(10);
  });

  test('fill paints the entire region', () => {
    const p = Printer.create({ width: 4, height: 2 });
    p.fill('.');
    expect(stripAnsi(p.lines()[0]!)).toBe('....');
    expect(stripAnsi(p.lines()[1]!)).toBe('....');
  });

  test('border draws box corners and edges', () => {
    const p = Printer.create({ width: 4, height: 3 });
    p.border();
    const lines = p.lines().map(stripAnsi);
    expect(lines[0]).toBe('┌──┐');
    expect(lines[1]).toBe('│  │');
    expect(lines[2]).toBe('└──┘');
  });

  test('focused flag propagates to sub by default, override possible', () => {
    const p = Printer.create({ width: 4, height: 1, focused: true });
    expect(p.focused).toBe(true);
    const s = p.sub(0, 0, 2, 1);
    expect(s.focused).toBe(true);
    const s2 = p.sub(0, 0, 2, 1, { focused: false });
    expect(s2.focused).toBe(false);
  });

  test('cellWidth: emoji, hangul, ANSI, surrogate', () => {
    expect(cellWidth('abc')).toBe(3);
    expect(cellWidth('안녕')).toBe(4);
    expect(cellWidth('\x1b[31mred\x1b[0m')).toBe(3);
    expect(cellWidth('')).toBe(0);
  });

  test('isWide: sanity checks', () => {
    expect(isWide(0x0041)).toBe(false);     // 'A'
    expect(isWide(0xAC00)).toBe(true);      // '가'
    expect(isWide(0x1F600)).toBe(true);     // 😀 (in supplementary range)
  });

  test('sub printer clipped to zero size is no-op safe', () => {
    const p = Printer.create({ width: 5, height: 3 });
    const c = p.sub(10, 10, 5, 5);   // fully outside
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
    c.text(0, 0, 'x');  // no-op, no throw
    expect(stripAnsi(p.lines()[0]!)).toBe('     ');
  });

  // Phase D-3 cleanup (2026-04-21) — the `backfillEmptyStyle (Option
  // D)` describe block was removed along with the method itself.
  // Phase D-2 `placeText` + `mergeStyle` in printer-cell-model
  // auto-preserve backdrop bg; the post-frame backfill helper is no
  // longer needed. Behaviour is now verified by the `mergeStyle`
  // tests in test/printer-cell-model.test.ts and the backdrop
  // continuity tests in test/modal-adapter-backdrop.test.ts.

  test('fill + placeText auto-preserves backdrop bg (merge semantics)', () => {
    // Was: "fill + placeText + backfill matches intended modal pattern".
    // Post-D-3: the backfill step is gone — merge does the same thing
    // automatically. Proof that the bg survives past a subsequent
    // placeText.
    const BG = '\x1b[48;2;1;2;3m';
    const p = Printer.create({ width: 8, height: 1 });
    p.fill(' ', BG);
    p.text(1, 0, 'label');   // empty-SGR overwrite → merge preserves bg
    const line = p.lines()[0]!;
    expect(line.startsWith(BG)).toBe(true);
    expect(line).toContain('label');
    expect(stripAnsi(line)).toBe(' label  ');
  });
});
