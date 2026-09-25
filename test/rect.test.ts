// R1 — Rect primitive unit tests.

import { describe, expect, test } from 'bun:test';

import {
  rectBottomRow,
  rectClampTo,
  rectContains,
  rectEquals,
  rectGrow,
  rectIntersect,
  rectIsEmpty,
  rectRightCol,
  rectShift,
  type Rect,
} from '../src/display/rect.js';

const R = (row: number, col: number, width: number, height: number): Rect =>
  ({ row, col, width, height });

describe('rectContains', () => {
  const r = R(5, 10, 4, 3); // rows 5..7, cols 10..13

  test('inside', () => {
    expect(rectContains(r, 5, 10)).toBe(true);  // top-left
    expect(rectContains(r, 7, 13)).toBe(true);  // bottom-right
    expect(rectContains(r, 6, 11)).toBe(true);  // middle
  });
  test('outside — above / below / left / right', () => {
    expect(rectContains(r, 4, 10)).toBe(false);
    expect(rectContains(r, 8, 10)).toBe(false);
    expect(rectContains(r, 5, 9)).toBe(false);
    expect(rectContains(r, 5, 14)).toBe(false);
  });
  test('zero-area rects return false for every point', () => {
    expect(rectContains(R(5, 10, 0, 3), 5, 10)).toBe(false);
    expect(rectContains(R(5, 10, 4, 0), 5, 10)).toBe(false);
    expect(rectContains(R(5, 10, 0, 0), 5, 10)).toBe(false);
  });
  test('negative width/height treated as empty', () => {
    expect(rectContains(R(5, 10, -2, 3), 5, 10)).toBe(false);
    expect(rectContains(R(5, 10, 4, -1), 5, 10)).toBe(false);
  });
});

describe('rectBottomRow / rectRightCol', () => {
  test('inclusive extents', () => {
    const r = R(5, 10, 4, 3);
    expect(rectBottomRow(r)).toBe(7);
    expect(rectRightCol(r)).toBe(13);
  });
});

describe('rectShift', () => {
  test('translate preserves size', () => {
    expect(rectShift(R(5, 10, 4, 3), 2, -3)).toEqual(R(7, 7, 4, 3));
  });
  test('negative shift can push rows below 1', () => {
    expect(rectShift(R(5, 10, 4, 3), -10, 0)).toEqual(R(-5, 10, 4, 3));
  });
});

describe('rectGrow', () => {
  const r = R(5, 10, 4, 3);
  test('single-side margins', () => {
    expect(rectGrow(r, { top: 2 })).toEqual(R(3, 10, 4, 5));
    expect(rectGrow(r, { bottom: 1 })).toEqual(R(5, 10, 4, 4));
    expect(rectGrow(r, { left: 3 })).toEqual(R(5, 7, 7, 3));
    expect(rectGrow(r, { right: 2 })).toEqual(R(5, 10, 6, 3));
  });
  test('combined margins', () => {
    expect(rectGrow(r, { top: 1, bottom: 1, left: 1, right: 1 })).toEqual(R(4, 9, 6, 5));
  });
  test('negative margins shrink; width/height clamp at 0', () => {
    expect(rectGrow(r, { top: -10 })).toEqual(R(15, 10, 4, 0));
  });
});

describe('rectClampTo', () => {
  const term = { rows: 24, cols: 80 };
  test('already-inside rect unchanged', () => {
    expect(rectClampTo(R(5, 10, 4, 3), term)).toEqual(R(5, 10, 4, 3));
  });
  test('clamp when starting before row 1 / col 1', () => {
    expect(rectClampTo(R(-2, -1, 10, 5), term)).toEqual(R(1, 1, 8, 2));
  });
  test('clamp when extending past bottom / right', () => {
    expect(rectClampTo(R(20, 70, 20, 10), term)).toEqual(R(20, 70, 11, 5));
  });
  test('rect entirely off-screen collapses to width/height 0', () => {
    const r = rectClampTo(R(50, 200, 10, 10), term);
    expect(rectIsEmpty(r)).toBe(true);
  });
});

describe('rectIntersect', () => {
  test('overlapping rects → overlap region', () => {
    const a = R(5, 10, 6, 4);  // rows 5..8, cols 10..15
    const b = R(7, 12, 10, 6); // rows 7..12, cols 12..21
    expect(rectIntersect(a, b)).toEqual(R(7, 12, 4, 2)); // rows 7..8, cols 12..15
  });
  test('non-overlapping rects → empty', () => {
    const a = R(5, 10, 6, 4);
    const b = R(15, 10, 6, 4);
    expect(rectIsEmpty(rectIntersect(a, b))).toBe(true);
  });
  test('edge-touching rects → empty (inclusive bounds don\'t share cells)', () => {
    const a = R(5, 10, 4, 3);  // rows 5..7
    const b = R(8, 10, 4, 3);  // rows 8..10 — touches at row 7/8 boundary
    expect(rectIsEmpty(rectIntersect(a, b))).toBe(true);
  });
});

describe('rectEquals / rectIsEmpty', () => {
  test('structural equality', () => {
    expect(rectEquals(R(1, 2, 3, 4), R(1, 2, 3, 4))).toBe(true);
    expect(rectEquals(R(1, 2, 3, 4), R(1, 2, 3, 5))).toBe(false);
  });
  test('empty detection', () => {
    expect(rectIsEmpty(R(1, 2, 0, 5))).toBe(true);
    expect(rectIsEmpty(R(1, 2, 5, 0))).toBe(true);
    expect(rectIsEmpty(R(1, 2, 5, 5))).toBe(false);
  });
});
