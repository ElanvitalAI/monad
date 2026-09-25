import type { ModalBounds } from '../display/modal-stack.js';

export type CompositeWindowLayoutMode = '1x1' | '2x1' | '2x2';

export interface CompositeWindowMatrixInput {
  bounds: ModalBounds;
  layoutMode?: Exclude<CompositeWindowLayoutMode, '1x1'> | 'auto';
  cellCount: number;
  columnWeights?: readonly number[];
  rowWeights?: readonly number[];
  gapCols?: number;
  gapRows?: number;
  minCellWidth?: number;
  minCellHeight?: number;
}

export interface CompositeWindowMatrixCell {
  index: number;
  gridRow: number;
  gridCol: number;
  bounds: ModalBounds;
}

export interface CompositeWindowMatrix {
  layoutMode: CompositeWindowLayoutMode;
  rows: number;
  cols: number;
  cells: CompositeWindowMatrixCell[];
  verticalDividers: number[];
  horizontalDividers: number[];
  focusOrder: number[];
}

export function buildCompositeWindowMatrix(
  input: CompositeWindowMatrixInput,
): CompositeWindowMatrix {
  const gapCols = Math.max(0, input.gapCols ?? 1);
  const gapRows = Math.max(0, input.gapRows ?? 1);
  const minCellWidth = Math.max(1, input.minCellWidth ?? 1);
  const minCellHeight = Math.max(1, input.minCellHeight ?? 1);
  const requested = resolveRequestedLayoutMode(input.layoutMode, input.cellCount);
  const layoutMode = resolveEffectiveLayoutMode({
    bounds: input.bounds,
    requested,
    cellCount: input.cellCount,
    gapCols,
    gapRows,
    minCellWidth,
    minCellHeight,
  });
  const dims = matrixDims(layoutMode);
  const widths = splitWeighted(
    Math.max(1, input.bounds.width),
    dims.cols,
    gapCols,
    input.columnWeights,
  );
  const heights = splitWeighted(
    Math.max(1, input.bounds.height),
    dims.rows,
    gapRows,
    input.rowWeights,
  );

  const cells: CompositeWindowMatrixCell[] = [];
  const verticalDividers: number[] = [];
  const horizontalDividers: number[] = [];

  let cursorCol = input.bounds.col;
  for (let colIdx = 0; colIdx < dims.cols - 1; colIdx++) {
    cursorCol += widths[colIdx]!;
    verticalDividers.push(cursorCol);
    cursorCol += gapCols;
  }

  let cursorRow = input.bounds.row;
  for (let rowIdx = 0; rowIdx < dims.rows - 1; rowIdx++) {
    cursorRow += heights[rowIdx]!;
    horizontalDividers.push(cursorRow);
    cursorRow += gapRows;
  }

  let index = 0;
  let rowStart = input.bounds.row;
  for (let gridRow = 0; gridRow < dims.rows; gridRow++) {
    let colStart = input.bounds.col;
    for (let gridCol = 0; gridCol < dims.cols; gridCol++) {
      if (index >= input.cellCount) break;
      cells.push({
        index,
        gridRow,
        gridCol,
        bounds: {
          row: rowStart,
          col: colStart,
          width: widths[gridCol]!,
          height: heights[gridRow]!,
        },
      });
      colStart += widths[gridCol]! + gapCols;
      index++;
    }
    rowStart += heights[gridRow]! + gapRows;
  }

  return {
    layoutMode,
    rows: dims.rows,
    cols: dims.cols,
    cells,
    verticalDividers,
    horizontalDividers,
    focusOrder: cells.map((cell) => cell.index),
  };
}

export function hitCompositeWindowMatrixCell(
  matrix: CompositeWindowMatrix,
  row: number,
  col: number,
): number {
  for (const cell of matrix.cells) {
    const b = cell.bounds;
    if (
      row >= b.row
      && row < b.row + b.height
      && col >= b.col
      && col < b.col + b.width
    ) {
      return cell.index;
    }
  }
  return -1;
}

export function cycleCompositeWindowMatrixFocus(
  matrix: CompositeWindowMatrix,
  current: number,
  dir: 1 | -1,
): number {
  const order = matrix.focusOrder;
  if (order.length <= 1) return current;
  const at = Math.max(0, order.indexOf(current));
  const next = (at + dir + order.length) % order.length;
  return order[next] ?? current;
}

function resolveRequestedLayoutMode(
  layoutMode: CompositeWindowMatrixInput['layoutMode'],
  cellCount: number,
): Exclude<CompositeWindowLayoutMode, '1x1'> {
  if (layoutMode && layoutMode !== 'auto') return layoutMode;
  return cellCount >= 3 ? '2x2' : '2x1';
}

function resolveEffectiveLayoutMode(input: {
  bounds: ModalBounds;
  requested: Exclude<CompositeWindowLayoutMode, '1x1'>;
  cellCount: number;
  gapCols: number;
  gapRows: number;
  minCellWidth: number;
  minCellHeight: number;
}): CompositeWindowLayoutMode {
  const canFit2x1 = input.cellCount >= 2
    && input.bounds.width >= input.minCellWidth * 2 + input.gapCols;
  const canFit2x2 = input.cellCount >= 3
    && input.bounds.width >= input.minCellWidth * 2 + input.gapCols
    && input.bounds.height >= input.minCellHeight * 2 + input.gapRows;

  if (input.requested === '2x2' && canFit2x2) return '2x2';
  if (canFit2x1) return '2x1';
  return '1x1';
}

function matrixDims(layoutMode: CompositeWindowLayoutMode): { rows: number; cols: number } {
  switch (layoutMode) {
    case '2x2':
      return { rows: 2, cols: 2 };
    case '2x1':
      return { rows: 1, cols: 2 };
    default:
      return { rows: 1, cols: 1 };
  }
}

function splitWeighted(
  total: number,
  cells: number,
  gap: number,
  rawWeights: readonly number[] | undefined,
): number[] {
  if (cells <= 1) return [total];
  const content = Math.max(1, total - gap * (cells - 1));
  const weights = Array.from({ length: cells }, (_, idx) => Math.max(0.001, rawWeights?.[idx] ?? 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const widths: number[] = [];
  let used = 0;
  for (let idx = 0; idx < cells; idx++) {
    if (idx === cells - 1) {
      widths.push(Math.max(1, content - used));
      continue;
    }
    const width = Math.max(1, Math.floor((content * weights[idx]!) / totalWeight));
    widths.push(width);
    used += width;
  }
  return widths;
}
