import type { PaneRect } from './layout-tree.js';
import type { PaneId } from './addressing.js';

export type VwSecondaryActionTarget =
  | { kind: 'pane-title'; paneId: PaneId }
  | { kind: 'pane-body'; paneId: PaneId }
  | { kind: 'border'; paneId: null };

export function secondaryActionTargetAt(
  rects: readonly PaneRect[],
  col: number,
  row: number,
): VwSecondaryActionTarget {
  const pane = rects.find(({ rect }) =>
    col >= rect.col
    && col < rect.col + rect.width
    && row >= rect.row
    && row < rect.row + rect.height,
  );
  if (!pane) return { kind: 'border', paneId: null };
  if (row === pane.rect.row) {
    return { kind: 'pane-title', paneId: pane.paneId };
  }
  return { kind: 'pane-body', paneId: pane.paneId };
}
