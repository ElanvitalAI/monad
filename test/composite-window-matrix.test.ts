import { describe, expect, test } from 'bun:test';
import {
  buildCompositeWindowMatrix,
  cycleCompositeWindowMatrixFocus,
  hitCompositeWindowMatrixCell,
} from '../src/window/composite-window-matrix.js';

describe('composite-window-matrix', () => {
  test('2x1 keeps weighted split for two-cell foreground windows', () => {
    const matrix = buildCompositeWindowMatrix({
      bounds: { row: 2, col: 4, width: 52, height: 10 },
      layoutMode: '2x1',
      cellCount: 2,
      columnWeights: [2, 3],
      minCellWidth: 10,
      minCellHeight: 4,
    });

    expect(matrix.layoutMode).toBe('2x1');
    expect(matrix.cells).toHaveLength(2);
    expect(matrix.cells[0]!.bounds.width).toBeLessThan(matrix.cells[1]!.bounds.width);
    expect(matrix.verticalDividers).toHaveLength(1);
    expect(matrix.horizontalDividers).toHaveLength(0);
  });

  test('2x2 returns row-major cells + divider coordinates', () => {
    const matrix = buildCompositeWindowMatrix({
      bounds: { row: 3, col: 5, width: 61, height: 19 },
      layoutMode: '2x2',
      cellCount: 4,
      minCellWidth: 10,
      minCellHeight: 6,
    });

    expect(matrix.layoutMode).toBe('2x2');
    expect(matrix.cells).toHaveLength(4);
    expect(matrix.cells[0]!.gridRow).toBe(0);
    expect(matrix.cells[1]!.gridCol).toBe(1);
    expect(matrix.cells[2]!.gridRow).toBe(1);
    expect(matrix.verticalDividers).toHaveLength(1);
    expect(matrix.horizontalDividers).toHaveLength(1);
  });

  test('falls back to 2x1 then 1x1 when a 2x2 matrix cannot fit', () => {
    const wideOnly = buildCompositeWindowMatrix({
      bounds: { row: 1, col: 1, width: 40, height: 8 },
      layoutMode: '2x2',
      cellCount: 4,
      minCellWidth: 12,
      minCellHeight: 5,
    });
    expect(wideOnly.layoutMode).toBe('2x1');

    const tiny = buildCompositeWindowMatrix({
      bounds: { row: 1, col: 1, width: 16, height: 8 },
      layoutMode: '2x2',
      cellCount: 4,
      minCellWidth: 12,
      minCellHeight: 5,
    });
    expect(tiny.layoutMode).toBe('1x1');
    expect(tiny.cells).toHaveLength(1);
  });

  test('hit testing and focus cycle follow the same matrix order', () => {
    const matrix = buildCompositeWindowMatrix({
      bounds: { row: 2, col: 2, width: 42, height: 14 },
      layoutMode: '2x2',
      cellCount: 4,
      minCellWidth: 8,
      minCellHeight: 4,
    });

    const bottomRight = matrix.cells[3]!.bounds;
    expect(hitCompositeWindowMatrixCell(matrix, bottomRight.row, bottomRight.col)).toBe(3);
    expect(cycleCompositeWindowMatrixFocus(matrix, 0, 1)).toBe(1);
    expect(cycleCompositeWindowMatrixFocus(matrix, 3, 1)).toBe(0);
    expect(cycleCompositeWindowMatrixFocus(matrix, 0, -1)).toBe(3);
  });
});
