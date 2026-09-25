// R1 — upward picker layout helper tests.

import { describe, expect, test } from 'bun:test';

import {
  PICKER_BOUNDS_EXTRA_ROWS,
  PICKER_SEPARATOR_ROWS,
  PICKER_TOP_HINT_ROWS,
  computeUpwardPickerLayout,
  hitTestPickerList,
} from '../src/display/picker-layout.js';

describe('computeUpwardPickerLayout', () => {
  test('small filtered list → visibleCount + list rows directly above separator', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: false,
    });
    expect(layout.visibleCount).toBe(3);
    expect(layout.startIdx).toBe(0);
    // separator directly above input: 30 - 1 = 29
    expect(layout.separatorRow).toBe(29);
    // listBottom = separator - 1 = 28
    expect(layout.listBottomRow).toBe(28);
    // listTop = bottom - (visibleCount - 1) = 28 - 2 = 26
    expect(layout.listTopRow).toBe(26);
    expect(layout.topHintRow).toBeNull();
  });

  test('at-picker hasTopHint reserves 1 row above the list top', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: true,
    });
    expect(layout.topHintRow).toBe(25); // listTop - 1
    expect(layout.listTopRow).toBe(26);
  });

  test('filteredCount > maxVisible → startIdx scrolls to center cursor', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 4, filteredCount: 20, cursor: 10, hasTopHint: false,
    });
    expect(layout.visibleCount).toBe(4);
    // startIdx = max(0, min(cursor - 2, 20 - 4)) = min(8, 16) = 8
    expect(layout.startIdx).toBe(8);
  });

  test('growing inputZoneHeight pushes the picker up by the same amount', () => {
    const a = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: false,
    });
    const b = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 3, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: false,
    });
    expect(a.separatorRow - b.separatorRow).toBe(2);
    expect(a.listTopRow - b.listTopRow).toBe(2);
    expect(a.listBottomRow - b.listBottomRow).toBe(2);
  });

  test('empty filter → visibleCount 0, list rows degenerate (bottom == top)', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 0, cursor: 0, hasTopHint: false,
    });
    expect(layout.visibleCount).toBe(0);
    expect(layout.listBottomRow).toBe(layout.listTopRow);
  });

  test('bounds encapsulate maxVisible + separator + topHint + safety', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: true,
    });
    // bounds.row = anchor.row - maxVisible - (separator + topHint + safety) = 30 - 6 - 3 = 21
    expect(layout.bounds.row).toBe(21);
    // bounds.height = anchor.row - bounds.row = 9
    expect(layout.bounds.height).toBe(9);
    // bounds width/col mirror the anchor
    expect(layout.bounds.col).toBe(1);
    expect(layout.bounds.width).toBe(80);
  });

  test('bounds stays the same when filter shrinks (uses maxVisible, not visibleCount)', () => {
    const full = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 6, cursor: 0, hasTopHint: true,
    });
    const narrow = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 1, cursor: 0, hasTopHint: true,
    });
    // bounds stays the same — maxVisible drives it, not the live filter size.
    expect(full.bounds).toEqual(narrow.bounds);
  });

  test('bounds.row clamped to 1 when anchor is close to the top of the terminal', () => {
    const layout = computeUpwardPickerLayout({
      anchorRow: 5, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 10, filteredCount: 3, cursor: 0, hasTopHint: true,
    });
    // Without clamping: row = 5 - 10 - 3 = -8 → clamped to 1.
    expect(layout.bounds.row).toBe(1);
  });
});

describe('hitTestPickerList', () => {
  const layout = computeUpwardPickerLayout({
    anchorRow: 30, anchorCol: 1, width: 80,
    inputZoneHeight: 1, maxVisible: 6, filteredCount: 3, cursor: 0, hasTopHint: false,
  });
  // listTopRow=26, listBottomRow=28, col span [1, 80]

  test('click on list row → filtIdx', () => {
    expect(hitTestPickerList(layout, 26, 10)).toBe(0);
    expect(hitTestPickerList(layout, 27, 10)).toBe(1);
    expect(hitTestPickerList(layout, 28, 10)).toBe(2);
  });

  test('click above top row / below bottom row → null', () => {
    expect(hitTestPickerList(layout, 25, 10)).toBeNull();
    expect(hitTestPickerList(layout, 29, 10)).toBeNull();
  });

  test('click outside horizontal span → null', () => {
    expect(hitTestPickerList(layout, 27, 0)).toBeNull();
    expect(hitTestPickerList(layout, 27, 81)).toBeNull();
  });

  test('empty filter → always null', () => {
    const empty = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 6, filteredCount: 0, cursor: 0, hasTopHint: false,
    });
    expect(hitTestPickerList(empty, 28, 10)).toBeNull();
  });

  test('scrolled picker — hit returns the scrolled filtIdx, not localY', () => {
    const scrolled = computeUpwardPickerLayout({
      anchorRow: 30, anchorCol: 1, width: 80,
      inputZoneHeight: 1, maxVisible: 4, filteredCount: 20, cursor: 10, hasTopHint: false,
    });
    // startIdx=8, listTopRow = listBottomRow - 3 = 25, so
    // click at row 25 → filtIdx = 8 + 0 = 8
    // click at row 28 → filtIdx = 8 + 3 = 11
    expect(hitTestPickerList(scrolled, scrolled.listTopRow, 10)).toBe(8);
    expect(hitTestPickerList(scrolled, scrolled.listBottomRow, 10)).toBe(11);
  });
});

describe('picker-layout constants', () => {
  test('PICKER_BOUNDS_EXTRA_ROWS = separator + topHint + safety', () => {
    // Forces a review whenever someone edits any of the three
    // constants: the total has to stay in sync with the bounds math.
    expect(PICKER_BOUNDS_EXTRA_ROWS).toBe(PICKER_SEPARATOR_ROWS + PICKER_TOP_HINT_ROWS + 1);
  });
});
