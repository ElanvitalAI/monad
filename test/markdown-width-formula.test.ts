// Regression test for the glow MD width bug.
//
// Before: src/dashboard.ts:2942 used `Math.max(30, termCols - 2*60 - 6)`
// which on any terminal < 160 cols collapsed to the 30-col floor — glow
// then wrapped MD at 30 cols even though the preview pane was 40-60
// cells wide. Root cause was the hardcoded `2 * 60` assuming both
// flank panes were always at their MAX cap.
//
// After: previewPaneWidthFor() mirrors the draw-time layout math at
// src/dashboard.ts:3914-3919, so the value glow receives on -w matches
// the actual pane width.

import { describe, test, expect } from 'bun:test';
import {
  paneHeightBeforeTargetRow,
  paneHeightForTargetRows,
  paneWidthForRatioRow,
  previewPaneWidthFor,
  ratioLayoutRowHeights,
  ratioRowPaneWidths,
} from '../src/panes/pane-sizing.js';

const normalTopRow = [
  { pane: 'browser', ratio: 1 },
  { pane: 'preview', ratio: 3 },
  { pane: 'sessions-sidebar', ratio: 1 },
] as const;

const normalRows = [
  { ratio: 2, panes: normalTopRow },
  { ratio: 3, panes: [{ pane: 'log', ratio: 1 }] },
] as const;

describe('pane-sizing — ratio rows', () => {
  test('distributes widths from ratio sum like yazi-style tuples', () => {
    expect(ratioRowPaneWidths(80, normalTopRow)).toEqual([
      { pane: 'browser', width: 15 },
      { pane: 'preview', width: 46 },
      { pane: 'sessions-sidebar', width: 16 },
    ]);
  });

  test('can address any pane by name', () => {
    expect(paneWidthForRatioRow(80, normalTopRow, 'browser')).toBe(20);
    expect(paneWidthForRatioRow(80, normalTopRow, 'preview')).toBe(46);
  });
});

describe('pane-sizing — preview pane width = glow -w', () => {
  test('80-col terminal, all three panes visible', () => {
    const w = previewPaneWidthFor(80, normalTopRow);
    expect(w).toBe(46);
  });

  test('80-col terminal, sessions hidden', () => {
    const w = previewPaneWidthFor(80, normalTopRow, new Set(['browser', 'preview']));
    expect(w).toBe(59);
  });

  test('120-col terminal, all three panes visible', () => {
    const w = previewPaneWidthFor(120, normalTopRow);
    expect(w).toBe(70);
  });

  test('160-col terminal, all three panes visible', () => {
    const w = previewPaneWidthFor(160, normalTopRow);
    expect(w).toBe(94);
  });

  test('very wide terminal keeps using ratio distribution', () => {
    const w = previewPaneWidthFor(400, normalTopRow);
    expect(w).toBe(238);
  });

  test('never returns below the 20-col floor on tiny terminals', () => {
    const w = previewPaneWidthFor(30, normalTopRow);
    expect(w).toBeGreaterThanOrEqual(20);
  });
});

describe('pane-sizing — ratio layout heights', () => {
  test('distributes row heights from ratio sum', () => {
    expect(ratioLayoutRowHeights(30, normalRows)).toEqual([
      { panes: ['browser', 'preview', 'sessions-sidebar'], height: 12 },
      { panes: ['log'], height: 18 },
    ]);
  });

  test('can address pane and log zones from the same row spec', () => {
    expect(paneHeightBeforeTargetRow(30, normalRows, 'log')).toBe(12);
    expect(paneHeightForTargetRows(30, normalRows, 'log')).toBe(18);
  });

  test('vertical ratio stays stable when side panes are hidden', () => {
    const visible = new Set(['browser', 'preview', 'log']);
    expect(ratioLayoutRowHeights(30, normalRows, visible)).toEqual([
      { panes: ['browser', 'preview'], height: 12 },
      { panes: ['log'], height: 18 },
    ]);
  });
});
