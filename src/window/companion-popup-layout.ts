import type { ModalBounds } from '../display/modal-stack.js';
import { planTabletCompanionSlot } from './tablet-workspace-policy.js';

export interface CompanionPopupLayoutInput {
  termCols: number;
  termRows: number;
  slotIndex: number;
  totalCount?: number;
  hasBlockingForeground?: boolean;
}

export function computeCompanionPopupBounds(
  input: CompanionPopupLayoutInput,
): ModalBounds {
  const plan = planTabletCompanionSlot({
    termCols: input.termCols,
    termRows: input.termRows,
    slotIndex: input.slotIndex,
    totalCount: Math.max(1, input.totalCount ?? (input.slotIndex + 1)),
    hasBlockingForeground: input.hasBlockingForeground === true,
  });
  return plan.bounds ?? { row: 1, col: 1, width: 1, height: 1 };
}
