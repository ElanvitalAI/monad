// Bottom-right transient toast.
//
// Built on top of showTransientTerminalModal with an explicit bounds
// override for bottom-right placement. Dashboard emits these on
// terminal modal open/close, session exit, and similar "happened,
// FYI" events where the user shouldn't lose their place.

import {
  showTransientTerminalModal,
  type TransientTerminalModalHandle,
} from '../modals/transient.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';

export interface ShowToastParams {
  title: string;
  lines?: string[];       // optional detail lines under the title
  ttlMs?: number;
  termCols: number;
  termRows: number;
  coordinator: DisplayCoordinator;
  /** Separate group so toasts don't clobber centered snapshot modals. */
  group?: string;
}

export function showToast(params: ShowToastParams): TransientTerminalModalHandle {
  const lines = params.lines ?? [''];
  // Width: content-aware, max 56 cells (half-terminal feel), min 24.
  const contentWidth = Math.max(
    params.title.length + 4,
    ...lines.map(l => l.length + 4),
  );
  const width = Math.max(24, Math.min(56, contentWidth));
  const height = Math.max(3, lines.length + 2);

  // Bottom-right anchor with 2-cell margin from both edges.
  const row = Math.max(1, params.termRows - height - 1);
  const col = Math.max(1, params.termCols - width - 1);

  return showTransientTerminalModal({
    title: params.title,
    lines,
    coordinator: params.coordinator,
    termCols: params.termCols,
    termRows: params.termRows,
    ttlMs: params.ttlMs ?? 2500,
    group: params.group ?? 'toast',
    bounds: { row, col, width, height },
  });
}
