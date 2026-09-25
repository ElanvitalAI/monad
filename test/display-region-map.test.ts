import { describe, expect, test } from 'bun:test';
import { DefaultRegionMap, rangesOverlap, unionRanges, type RowRange } from '../src/display/region-map.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { DisplaySurface } from '../src/display/types.js';

function modal(id: string, bounds: ModalSurface['bounds']): ModalSurface {
  return {
    id,
    kind: 'modal',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
    bounds,
    paint: () => '',
  };
}

function pane(id: string): DisplaySurface {
  return {
    id,
    kind: 'pane',
    owner: 'dashboard',
    focus: 'owns',
    priority: 0,
    render: () => [],
  };
}

describe('DefaultRegionMap', () => {
  const rm = new DefaultRegionMap();

  test('resolves modal bounds → 1-indexed inclusive row range', () => {
    const m = modal('pick', { row: 5, col: 3, width: 20, height: 8 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 5, endRow: 12 });
  });

  test('clamps top edge to row 1', () => {
    const m = modal('above', { row: 0, col: 1, width: 10, height: 4 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 1, endRow: 3 });
  });

  test('clamps bottom edge to terminal rows', () => {
    const m = modal('below', { row: 38, col: 1, width: 10, height: 20 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 38, endRow: 40 });
  });

  test('returns null when entirely off-screen below', () => {
    const m = modal('offscreen', { row: 100, col: 1, width: 10, height: 5 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toBeNull();
  });

  test('returns null when height is zero', () => {
    const m = modal('empty', { row: 5, col: 1, width: 10, height: 0 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toBeNull();
  });

  test('returns null for non-modal surfaces (pane/widget/etc.)', () => {
    expect(rm.resolve(pane('pane:log'), { rows: 40, cols: 120 })).toBeNull();
  });

  test('returns null for pseudo-modal surfaces missing bounds or paint', () => {
    const broken = { ...pane('fake'), kind: 'modal' as const } as DisplaySurface;
    expect(rm.resolve(broken, { rows: 40, cols: 120 })).toBeNull();
  });

  test('single-row modal resolves to start===end', () => {
    const m = modal('thin', { row: 10, col: 5, width: 10, height: 1 });
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 10, endRow: 10 });
  });

  test('includes visualBounds rows when decoration paints outside bounds', () => {
    const m = {
      ...modal('shadowed', { row: 10, col: 5, width: 20, height: 6 }),
      visualBounds: { row: 10, col: 5, width: 21, height: 7 },
    };
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 10, endRow: 16 });
  });

  test('unions backdropBounds with visual bounds for invalidate coverage', () => {
    const m = {
      ...modal('backdrop', { row: 8, col: 10, width: 30, height: 10 }),
      visualBounds: { row: 12, col: 20, width: 12, height: 4 },
      backdropBounds: { row: 1, col: 1, width: 120, height: 24 },
    };
    expect(rm.resolve(m, { rows: 40, cols: 120 })).toEqual({ startRow: 1, endRow: 24 });
  });
});

describe('unionRanges', () => {
  test('empty input → empty output', () => {
    expect(unionRanges([])).toEqual([]);
  });

  test('single range passes through', () => {
    const r: RowRange = { startRow: 3, endRow: 7 };
    expect(unionRanges([r])).toEqual([r]);
  });

  test('merges overlapping ranges', () => {
    expect(unionRanges([
      { startRow: 1, endRow: 5 },
      { startRow: 4, endRow: 10 },
    ])).toEqual([{ startRow: 1, endRow: 10 }]);
  });

  test('merges touching ranges (gap of 1)', () => {
    expect(unionRanges([
      { startRow: 1, endRow: 5 },
      { startRow: 6, endRow: 9 },
    ])).toEqual([{ startRow: 1, endRow: 9 }]);
  });

  test('keeps disjoint ranges separate and sorted', () => {
    expect(unionRanges([
      { startRow: 20, endRow: 25 },
      { startRow: 1, endRow: 5 },
      { startRow: 10, endRow: 12 },
    ])).toEqual([
      { startRow: 1, endRow: 5 },
      { startRow: 10, endRow: 12 },
      { startRow: 20, endRow: 25 },
    ]);
  });

  test('absorbs a fully contained range', () => {
    expect(unionRanges([
      { startRow: 1, endRow: 20 },
      { startRow: 5, endRow: 10 },
    ])).toEqual([{ startRow: 1, endRow: 20 }]);
  });
});

describe('rangesOverlap', () => {
  test('detects overlap', () => {
    expect(rangesOverlap({ startRow: 1, endRow: 5 }, { startRow: 4, endRow: 10 })).toBe(true);
  });
  test('detects no overlap', () => {
    expect(rangesOverlap({ startRow: 1, endRow: 5 }, { startRow: 6, endRow: 10 })).toBe(false);
  });
  test('edge-touching counts as overlap', () => {
    expect(rangesOverlap({ startRow: 1, endRow: 5 }, { startRow: 5, endRow: 10 })).toBe(true);
  });
});
