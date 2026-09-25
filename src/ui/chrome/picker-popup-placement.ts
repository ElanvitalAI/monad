import type { ModalBounds } from '../../display/modal-stack.js';

export interface PopupPlacement {
  anchorStartCol: number;
  anchorEndCol: number;
  statusRow: number;
  termCols: number;
  termRows: number;
}

export function computePopupBounds(
  p: PopupPlacement,
  desired: { width: number; height: number },
): ModalBounds {
  const width = Math.min(desired.width, p.termCols - 2);
  const height = Math.min(desired.height, p.termRows - 2);

  let col = p.anchorStartCol + 1;
  if (col + width - 1 > p.termCols) col = Math.max(1, p.termCols - width + 1);

  const spaceAbove = p.statusRow - 1;
  const spaceBelow = p.termRows - p.statusRow;
  const row = spaceAbove >= height
    ? Math.max(1, p.statusRow - height)
    : p.statusRow + 1 <= p.termRows ? p.statusRow + 1 : 1;
  void spaceBelow;

  return { row, col, width, height };
}
