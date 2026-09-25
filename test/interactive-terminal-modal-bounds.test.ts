import { describe, expect, test } from 'bun:test';
import {
  computeDefaultBounds,
  clampBoundsToTerm,
  presetBounds,
  MODAL_SIZE_PRESETS,
  INTERACTIVE_MIN_COLS,
  INTERACTIVE_MIN_ROWS,
} from '../src/interactive-terminal-modal.js';

describe('computeDefaultBounds — narrow terminal fallback', () => {
  test('fullscreen fallback when terminal narrower than min cols', () => {
    // Tablet-ish 30x20 terminal. Pre-fix this returned width=40 and
    // col=1, painting 10 cells off the right edge and wrapping.
    const b = computeDefaultBounds(30, 20);
    expect(b.col + b.width - 1).toBeLessThanOrEqual(30);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(20);
  });

  test('fullscreen fallback when terminal shorter than min rows', () => {
    // Wide but short — squished SSH pane.
    const b = computeDefaultBounds(100, 6);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(6);
  });

  test('roomy terminal still uses ratio-based centered bounds', () => {
    const b = computeDefaultBounds(160, 50);
    expect(b.width).toBeGreaterThanOrEqual(INTERACTIVE_MIN_COLS);
    expect(b.height).toBeGreaterThanOrEqual(INTERACTIVE_MIN_ROWS);
    // Centered.
    expect(Math.abs(b.col - Math.floor((160 - b.width) / 2) - 1)).toBeLessThanOrEqual(1);
  });

  test('edge: terminal exactly big enough for min + 2 padding still ratio', () => {
    const b = computeDefaultBounds(INTERACTIVE_MIN_COLS + 2, INTERACTIVE_MIN_ROWS + 2);
    expect(b.col + b.width - 1).toBeLessThanOrEqual(INTERACTIVE_MIN_COLS + 2);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(INTERACTIVE_MIN_ROWS + 2);
  });

  test('tiny terminal still produces paintable (w>=4, h>=3) bounds', () => {
    const b = computeDefaultBounds(6, 4);
    expect(b.width).toBeGreaterThanOrEqual(4);
    expect(b.height).toBeGreaterThanOrEqual(3);
  });
});

describe('clampBoundsToTerm', () => {
  test('overflowing width shrinks to fit', () => {
    const b = clampBoundsToTerm({ row: 1, col: 1, width: 100, height: 10 }, 40, 20);
    expect(b.col + b.width - 1).toBeLessThanOrEqual(40);
  });

  test('overflowing row position clamped + height shrunk', () => {
    const b = clampBoundsToTerm({ row: 50, col: 5, width: 20, height: 10 }, 80, 30);
    expect(b.row).toBeLessThanOrEqual(30);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(30);
  });

  test('in-range bounds pass through unchanged', () => {
    const b = clampBoundsToTerm({ row: 5, col: 5, width: 20, height: 10 }, 80, 30);
    expect(b).toEqual({ row: 5, col: 5, width: 20, height: 10 });
  });

  test('preserves minimum paintable size when terminal is tiny', () => {
    const b = clampBoundsToTerm({ row: 1, col: 1, width: 100, height: 100 }, 3, 2);
    // Can't fit 4x3 in 3x2 — the clamp still returns at least the
    // paint-bail size so the modal skips paint rather than crashes.
    expect(b.width).toBeGreaterThanOrEqual(4);
    expect(b.height).toBeGreaterThanOrEqual(3);
  });
});

describe('MT1 — presetBounds', () => {
  test('registry exposes 5 presets (default/80x24/132x40/200x60/full)', () => {
    expect(MODAL_SIZE_PRESETS).toEqual(['default', '80x24', '132x40', '200x60', 'full']);
  });

  test("'80x24' centers a fixed-size modal on a roomy terminal", () => {
    const b = presetBounds('80x24', 160, 50);
    expect(b.width).toBe(80);
    expect(b.height).toBe(24);
    // Centered: (160-80)/2+1 = 41, (50-24)/2+1 = 14
    expect(b.col).toBe(41);
    expect(b.row).toBe(14);
  });

  test("'132x40' falls back to default when terminal is too small", () => {
    const b = presetBounds('132x40', 80, 24);
    // Falls to computeDefaultBounds — won't be 132x40.
    expect(b.width).toBeLessThan(132);
  });

  test("'full' takes the whole viewport", () => {
    const b = presetBounds('full', 120, 40);
    expect(b).toEqual({ row: 1, col: 1, width: 120, height: 40 });
  });

  test("'default' delegates to computeDefaultBounds", () => {
    expect(presetBounds('default', 200, 60)).toEqual(computeDefaultBounds(200, 60));
  });

  test("'200x60' activates on ultrawide terminals only", () => {
    const fits = presetBounds('200x60', 220, 70);
    expect(fits.width).toBe(200);
    expect(fits.height).toBe(60);
    const falls = presetBounds('200x60', 100, 30);
    expect(falls.width).toBeLessThan(200);
  });
});
