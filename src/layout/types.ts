// ── Layout type system ──
// A Layout describes how widget instances are composed into the top
// (non-log, non-input) region of the dashboard. It is a flat grid of
// rows × cells — each cell references a WidgetInstance by id. Modals
// overlay the grid. No nested grids in this phase (PLAN §4 trade-off).
//
// Values are plain data. All mutations produce a new Layout (immutable
// semantics) — the layout-host module provides the mutators.

/** Sizing hint for rows + cells.
 *  - A number in (0, 1) is a fraction of the available space (e.g. 0.5)
 *  - A positive number ≥ 1 is an absolute cell/row count (rounded down)
 *  - 'flex' means "take whatever remains after fixed sizes are removed"
 *
 *  `1` means "exactly 1 row/col" — NOT "100%". Use 'flex' for full width. */
export type Size = number | 'flex';

export interface LayoutCell {
  /** Reference to a WidgetInstance.id. null = empty spacer cell. */
  widgetInstanceId: string | null;
  /** Width hint. Default 'flex'. */
  width?: Size;
}

export interface LayoutRow {
  /** Height hint. Default 'flex'. */
  height?: Size;
  cells: LayoutCell[];
}

export interface ModalPlacement {
  id: string;                     // stable across re-renders (e.g. 'confirm-exit')
  widgetInstanceId: string;
  /** Where the modal anchors. 'center' = centered in the screen.
   *  Coord form gives absolute cell position (row, col). */
  position: 'center' | { row: number; col: number };
  /** Explicit size override. Defaults come from the widget + terminal size. */
  size?: { width: number; height: number };
}

export interface Layout {
  rows: LayoutRow[];
  modals: ModalPlacement[];
}

/** Reserved identifiers the layout host uses for structural operations.
 *  Widget instance ids that collide with these are rejected. */
export const LAYOUT_RESERVED_IDS = new Set(['__empty__', '__log__', '__input__']);
