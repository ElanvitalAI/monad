// ── Layout host — pure mutation API for grid layouts ──
// Every operation returns a NEW Layout; inputs are never mutated.
// Validation runs at the boundary (on input) so callers get a clear
// error before half-mutations happen. Render + keyboard routing are
// handled elsewhere (W3) — this module is pure data transformation.

import type { Layout, LayoutRow, LayoutCell, ModalPlacement, Size } from './types.js';
import { LAYOUT_RESERVED_IDS } from './types.js';

// ── Factory ────────────────────────────────────────────

export function createLayout(rows: LayoutRow[] = [], modals: ModalPlacement[] = []): Layout {
  const layout: Layout = { rows, modals };
  validate(layout);
  return layout;
}

/** The zero-content default: one flex row, empty cell. Useful as a
 *  starting point before widgets are spawned. */
export function emptyLayout(): Layout {
  return createLayout([
    { height: 'flex', cells: [{ widgetInstanceId: null, width: 'flex' }] },
  ]);
}

// ── Queries ────────────────────────────────────────────

/** Find the (row, col) coordinates of a widget instance id, or null. */
export function locate(layout: Layout, instanceId: string): { row: number; col: number } | null {
  for (let r = 0; r < layout.rows.length; r++) {
    const row = layout.rows[r]!;
    for (let c = 0; c < row.cells.length; c++) {
      if (row.cells[c]!.widgetInstanceId === instanceId) return { row: r, col: c };
    }
  }
  return null;
}

/** List every widget instance id currently placed in the layout (including modals). */
export function instanceIds(layout: Layout): string[] {
  const ids: string[] = [];
  for (const row of layout.rows) {
    for (const cell of row.cells) {
      if (cell.widgetInstanceId) ids.push(cell.widgetInstanceId);
    }
  }
  for (const m of layout.modals) ids.push(m.widgetInstanceId);
  return ids;
}

// ── Structural mutations ───────────────────────────────

export function addRow(layout: Layout, row: LayoutRow, at?: number): Layout {
  const rows = [...layout.rows];
  const index = at ?? rows.length;
  if (index < 0 || index > rows.length) {
    throw new Error(`addRow: index ${index} out of range [0, ${rows.length}]`);
  }
  rows.splice(index, 0, row);
  return createLayout(rows, layout.modals);
}

export function removeRow(layout: Layout, index: number): Layout {
  if (index < 0 || index >= layout.rows.length) {
    throw new Error(`removeRow: index ${index} out of range [0, ${layout.rows.length - 1}]`);
  }
  if (layout.rows.length === 1) {
    throw new Error('removeRow: cannot remove the last row — use emptyLayout() instead');
  }
  const rows = layout.rows.filter((_, i) => i !== index);
  return createLayout(rows, layout.modals);
}

/** Insert a cell at (row, col). If col is omitted the cell is appended. */
export function addCell(layout: Layout, row: number, cell: LayoutCell, col?: number): Layout {
  if (row < 0 || row >= layout.rows.length) {
    throw new Error(`addCell: row ${row} out of range [0, ${layout.rows.length - 1}]`);
  }
  const targetRow = layout.rows[row]!;
  const nextCells = [...targetRow.cells];
  const index = col ?? nextCells.length;
  if (index < 0 || index > nextCells.length) {
    throw new Error(`addCell: col ${index} out of range [0, ${nextCells.length}]`);
  }
  nextCells.splice(index, 0, cell);
  const rows = layout.rows.map((r, i) => i === row ? { ...r, cells: nextCells } : r);
  return createLayout(rows, layout.modals);
}

export function removeCell(layout: Layout, row: number, col: number): Layout {
  if (row < 0 || row >= layout.rows.length) {
    throw new Error(`removeCell: row ${row} out of range`);
  }
  const targetRow = layout.rows[row]!;
  if (col < 0 || col >= targetRow.cells.length) {
    throw new Error(`removeCell: col ${col} out of range`);
  }
  if (targetRow.cells.length === 1) {
    throw new Error('removeCell: cannot remove the last cell in a row — removeRow instead');
  }
  const nextCells = targetRow.cells.filter((_, i) => i !== col);
  const rows = layout.rows.map((r, i) => i === row ? { ...r, cells: nextCells } : r);
  return createLayout(rows, layout.modals);
}

// ── Widget placement ───────────────────────────────────

/** Place a widget instance id into an existing cell. Replaces whatever
 *  was there (including another widget — caller's responsibility to
 *  dispose the old one via widget-host). */
export function placeWidget(layout: Layout, row: number, col: number, instanceId: string | null): Layout {
  if (row < 0 || row >= layout.rows.length) {
    throw new Error(`placeWidget: row ${row} out of range`);
  }
  const targetRow = layout.rows[row]!;
  if (col < 0 || col >= targetRow.cells.length) {
    throw new Error(`placeWidget: col ${col} out of range`);
  }
  if (instanceId !== null && LAYOUT_RESERVED_IDS.has(instanceId)) {
    throw new Error(`placeWidget: "${instanceId}" is a reserved id`);
  }
  // Duplicate check (only meaningful for non-null ids)
  if (instanceId !== null) {
    for (let r = 0; r < layout.rows.length; r++) {
      for (let c = 0; c < layout.rows[r]!.cells.length; c++) {
        if (r === row && c === col) continue;
        if (layout.rows[r]!.cells[c]!.widgetInstanceId === instanceId) {
          throw new Error(`placeWidget: instance id "${instanceId}" already placed at (${r}, ${c})`);
        }
      }
    }
  }
  const nextCells = [...targetRow.cells];
  nextCells[col] = { ...nextCells[col]!, widgetInstanceId: instanceId };
  const rows = layout.rows.map((r, i) => i === row ? { ...r, cells: nextCells } : r);
  return createLayout(rows, layout.modals);
}

/** Remove a widget by id, leaving its cell empty (widgetInstanceId=null). */
export function removeWidget(layout: Layout, instanceId: string): Layout {
  const pos = locate(layout, instanceId);
  if (!pos) return layout;
  return placeWidget(layout, pos.row, pos.col, null);
}

// ── Sizing ─────────────────────────────────────────────

export function resizeCell(layout: Layout, row: number, col: number, width: Size): Layout {
  if (row < 0 || row >= layout.rows.length) {
    throw new Error(`resizeCell: row ${row} out of range`);
  }
  const targetRow = layout.rows[row]!;
  if (col < 0 || col >= targetRow.cells.length) {
    throw new Error(`resizeCell: col ${col} out of range`);
  }
  const nextCells = [...targetRow.cells];
  nextCells[col] = { ...nextCells[col]!, width };
  const rows = layout.rows.map((r, i) => i === row ? { ...r, cells: nextCells } : r);
  return createLayout(rows, layout.modals);
}

export function resizeRow(layout: Layout, row: number, height: Size): Layout {
  if (row < 0 || row >= layout.rows.length) {
    throw new Error(`resizeRow: row ${row} out of range`);
  }
  const rows = layout.rows.map((r, i) => i === row ? { ...r, height } : r);
  return createLayout(rows, layout.modals);
}

// ── Modals ─────────────────────────────────────────────

export function openModal(layout: Layout, modal: ModalPlacement): Layout {
  if (layout.modals.some(m => m.id === modal.id)) {
    throw new Error(`openModal: modal "${modal.id}" is already open`);
  }
  if (LAYOUT_RESERVED_IDS.has(modal.widgetInstanceId)) {
    throw new Error(`openModal: "${modal.widgetInstanceId}" is a reserved id`);
  }
  return createLayout(layout.rows, [...layout.modals, modal]);
}

export function closeModal(layout: Layout, modalId: string): Layout {
  return createLayout(layout.rows, layout.modals.filter(m => m.id !== modalId));
}

// ── Validator ──────────────────────────────────────────
// Runs on every constructed Layout. Keep error messages specific so
// LLM tool_call failures teach the model what's wrong next turn.

function validate(layout: Layout): void {
  if (!Array.isArray(layout.rows)) throw new Error('Layout.rows must be an array');
  if (!Array.isArray(layout.modals)) throw new Error('Layout.modals must be an array');

  if (layout.rows.length === 0) {
    throw new Error('Layout must have at least one row (use emptyLayout() for zero-content)');
  }

  const seenInstanceIds = new Set<string>();
  for (let r = 0; r < layout.rows.length; r++) {
    const row = layout.rows[r]!;
    if (!Array.isArray(row.cells) || row.cells.length === 0) {
      throw new Error(`Layout row ${r} must have at least one cell`);
    }
    if (row.height !== undefined) validateSize(row.height, `row ${r} height`);
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c]!;
      if (cell.width !== undefined) validateSize(cell.width, `row ${r} cell ${c} width`);
      const id = cell.widgetInstanceId;
      if (id !== null) {
        if (LAYOUT_RESERVED_IDS.has(id)) {
          throw new Error(`widget instance id "${id}" is reserved`);
        }
        if (seenInstanceIds.has(id)) {
          throw new Error(`widget instance id "${id}" appears more than once in the grid`);
        }
        seenInstanceIds.add(id);
      }
    }
  }

  const seenModalIds = new Set<string>();
  for (const m of layout.modals) {
    if (seenModalIds.has(m.id)) throw new Error(`modal id "${m.id}" appears twice`);
    seenModalIds.add(m.id);
    if (LAYOUT_RESERVED_IDS.has(m.widgetInstanceId)) {
      throw new Error(`modal widget instance id "${m.widgetInstanceId}" is reserved`);
    }
  }
}

function validateSize(size: Size, where: string): void {
  if (size === 'flex') return;
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    throw new Error(`${where}: size must be a finite number or 'flex'`);
  }
  if (size <= 0) {
    throw new Error(`${where}: size must be > 0`);
  }
}

// ── Solver ─────────────────────────────────────────────
// Given a list of size hints and the total space available, return
// the absolute per-slot allocation. Used by the render pipeline but
// useful to expose here so tests can assert sizing behavior without
// pulling in render machinery.

export function solveSizes(hints: Size[], total: number): number[] {
  if (hints.length === 0 || total <= 0) return hints.map(() => 0);
  // Step 1: settle fractional sizes (0 < n < 1) + absolute sizes (n >= 1)
  // Step 2: remainder goes to 'flex' slots evenly.
  //
  // n = 1 is treated as an absolute 1 row / 1 column, NOT a 100% fraction
  // — "take exactly one row" is the common case (header bars); full-width
  // fractions can use 'flex' or 0.999 if really needed.
  const absolute: number[] = hints.map(h => {
    if (h === 'flex') return -1;
    if (h > 0 && h < 1) return Math.floor(total * h);
    return Math.floor(h);
  });
  const fixedTotal = absolute.reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
  const flexCount = absolute.filter(v => v < 0).length;
  const remainder = Math.max(0, total - fixedTotal);
  const perFlex = flexCount > 0 ? Math.floor(remainder / flexCount) : 0;
  const result = absolute.map(v => v < 0 ? perFlex : v);
  // Give rounding leftovers to the last flex slot, or last slot if none
  const used = result.reduce((a, b) => a + b, 0);
  if (used < total) {
    const leftover = total - used;
    const lastFlex = result.findIndex((_, i) => absolute[i] === -1);
    const targetIdx = lastFlex >= 0 ? result.lastIndexOf(perFlex) : result.length - 1;
    if (targetIdx >= 0) result[targetIdx]! += leftover;
  }
  return result;
}
