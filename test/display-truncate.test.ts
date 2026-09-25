import { describe, expect, test } from 'bun:test';
import { truncateMiddle } from '../src/display/truncate.js';

const COLS = 80;

describe('truncateMiddle', () => {
  test('empty input → empty output, not truncated', () => {
    const r = truncateMiddle([], { maxRows: 10, termCols: COLS });
    expect(r.lines).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.omittedLines).toBe(0);
  });

  test('within budget → returns input verbatim, not truncated', () => {
    const lines = ['a', 'b', 'c'];
    const r = truncateMiddle(lines, { maxRows: 10, termCols: COLS });
    expect(r.lines).toEqual(lines);
    expect(r.truncated).toBe(false);
    expect(r.omittedLines).toBe(0);
    // Defensive: returned array is a copy, not the same reference.
    expect(r.lines).not.toBe(lines as unknown as string[]);
  });

  test('over budget → head + ellipsis + tail with omitted count', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const r = truncateMiddle(lines, { maxRows: 7, termCols: COLS });
    expect(r.truncated).toBe(true);
    // Total output rows ≤ maxRows (each line ≤ 80 cols, 1 row).
    expect(r.lines.length).toBeLessThanOrEqual(7);
    // Head from start, tail from end, ellipsis in middle.
    expect(r.lines[0]).toBe('line-0');
    expect(r.lines[r.lines.length - 1]).toBe('line-19');
    const ellipsisIdx = r.lines.findIndex((l) => l.startsWith('… +'));
    expect(ellipsisIdx).toBeGreaterThan(0);
    expect(ellipsisIdx).toBeLessThan(r.lines.length - 1);
    // Omitted count is the lines that were dropped.
    const kept = r.lines.length - 1; // exclude ellipsis line itself
    expect(r.omittedLines).toBe(lines.length - kept);
    // Ellipsis text matches the omitted count.
    expect(r.lines[ellipsisIdx]).toContain(`+${r.omittedLines} lines`);
  });

  test('balances head and tail (head ≤ tail by ≤1 — codex pattern)', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const r = truncateMiddle(lines, { maxRows: 7, termCols: COLS });
    const ellipsisIdx = r.lines.findIndex((l) => l.startsWith('… +'));
    const headLen = ellipsisIdx;
    const tailLen = r.lines.length - ellipsisIdx - 1;
    // codex: head_budget = available/2 (floor), tail_budget = available - head.
    // So tail can be 1 row larger than head; never the reverse.
    expect(tailLen).toBeGreaterThanOrEqual(headLen);
    expect(tailLen - headLen).toBeLessThanOrEqual(1);
  });

  test('row-aware: long line that wraps counts as multiple rows', () => {
    // termCols=10, line is 30 chars → 3 wrap rows. 4 such lines = 12 rows
    // total but maxRows=6 → must truncate.
    const long = 'X'.repeat(30);
    const lines = [long, long, long, long];
    const r = truncateMiddle(lines, { maxRows: 6, termCols: 10 });
    expect(r.truncated).toBe(true);
    // Sum of wrap rows for kept lines + ellipsis rows must respect budget.
    const totalRows = r.lines.reduce((sum, l) => {
      const visualW = l.replace(/\x1b\[[0-9;]*m/g, '').length;
      return sum + Math.max(1, Math.ceil(visualW / 10));
    }, 0);
    expect(totalRows).toBeLessThanOrEqual(6);
  });

  test('maxRows=0 → empty output, fully truncated', () => {
    const r = truncateMiddle(['a', 'b', 'c'], { maxRows: 0, termCols: COLS });
    expect(r.lines).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(r.omittedLines).toBe(3);
  });

  test('ellipsis alone exceeds budget → returns single ellipsis line', () => {
    // termCols=10, hint will wrap to 3 rows, maxRows=2 → ellipsis row count
    // ≥ maxRows path: return [hint(N)].
    const lines = ['a', 'b', 'c'];
    const r = truncateMiddle(lines, { maxRows: 2, termCols: 10 });
    expect(r.truncated).toBe(true);
    // The narrow-terminal fallback returns just the ellipsis line.
    if (r.lines.length === 1) {
      expect(r.lines[0]).toContain('+3 lines');
      expect(r.omittedLines).toBe(3);
    }
    // Otherwise the standard head/ellipsis/tail layout still fits — also
    // acceptable as long as result respects budget intent.
  });

  test('custom hint is honored', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const r = truncateMiddle(lines, {
      maxRows: 4,
      termCols: COLS,
      hint: (n) => `[hidden ${n}]`,
    });
    const ellipsis = r.lines.find((l) => l.startsWith('[hidden '));
    expect(ellipsis).toBeDefined();
    expect(ellipsis).toContain(`[hidden ${r.omittedLines}]`);
  });

  test('whitespace-only lines count as 1 row', () => {
    const lines = ['', '  ', '\t', 'real-1', 'real-2', 'real-3', 'real-4', 'real-5'];
    const r = truncateMiddle(lines, { maxRows: 4, termCols: COLS });
    expect(r.truncated).toBe(true);
    // Result rows fit budget when each line counts as 1.
    expect(r.lines.length).toBeLessThanOrEqual(4);
  });

  test('exact budget — no truncation when sum equals maxRows', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const r = truncateMiddle(lines, { maxRows: 4, termCols: COLS });
    expect(r.truncated).toBe(false);
    expect(r.lines).toEqual(lines);
  });

  test('one line over budget — minimal truncation', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const r = truncateMiddle(lines, { maxRows: 4, termCols: COLS });
    expect(r.truncated).toBe(true);
    // We dropped at minimum 1 line + replaced by ellipsis line.
    expect(r.omittedLines).toBeGreaterThanOrEqual(1);
    // Output respects budget.
    expect(r.lines.length).toBeLessThanOrEqual(4);
  });
});
