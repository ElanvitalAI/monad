// ── Layout host tests ──

import { describe, test, expect } from 'bun:test';
import {
  createLayout, emptyLayout,
  addRow, removeRow, addCell, removeCell,
  placeWidget, removeWidget,
  resizeCell, resizeRow,
  openModal, closeModal,
  locate, instanceIds, solveSizes,
} from '../src/layout/host.js';
import type { Layout, LayoutRow, LayoutCell, ModalPlacement } from '../src/layout/types.js';

const row = (cells: LayoutCell[], height: LayoutRow['height'] = 'flex'): LayoutRow => ({ height, cells });
const cell = (id: string | null = null, width: LayoutCell['width'] = 'flex'): LayoutCell => ({ widgetInstanceId: id, width });

describe('createLayout / emptyLayout', () => {
  test('emptyLayout has one row + one empty cell', () => {
    const l = emptyLayout();
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]!.cells).toHaveLength(1);
    expect(l.rows[0]!.cells[0]!.widgetInstanceId).toBeNull();
  });

  test('createLayout rejects zero-row input', () => {
    expect(() => createLayout([])).toThrow(/at least one row/);
  });

  test('createLayout rejects rows with zero cells', () => {
    expect(() => createLayout([row([])])).toThrow(/at least one cell/);
  });

  test('createLayout rejects reserved instance id', () => {
    expect(() => createLayout([row([cell('__log__')])])).toThrow(/reserved/);
  });

  test('createLayout rejects duplicate instance ids', () => {
    expect(() => createLayout([row([cell('a'), cell('a')])])).toThrow(/more than once/);
  });

  test('createLayout rejects invalid size hint', () => {
    expect(() => createLayout([row([cell(null, -1 as any)])])).toThrow(/> 0/);
    expect(() => createLayout([row([cell(null, NaN as any)])])).toThrow(/finite number or 'flex'/);
  });
});

describe('row mutations', () => {
  test('addRow appends at end by default', () => {
    const l = emptyLayout();
    const r = row([cell('w1')]);
    const next = addRow(l, r);
    expect(next.rows).toHaveLength(2);
    expect(next.rows[1]!.cells[0]!.widgetInstanceId).toBe('w1');
  });

  test('addRow with explicit index inserts there', () => {
    const l = createLayout([row([cell('a')]), row([cell('c')])]);
    const next = addRow(l, row([cell('b')]), 1);
    expect(next.rows.map(r => r.cells[0]!.widgetInstanceId)).toEqual(['a', 'b', 'c']);
  });

  test('addRow is immutable — original untouched', () => {
    const l = emptyLayout();
    const next = addRow(l, row([cell('x')]));
    expect(l.rows).toHaveLength(1);
    expect(next).not.toBe(l);
  });

  test('removeRow blocks removing the last row', () => {
    const l = emptyLayout();
    expect(() => removeRow(l, 0)).toThrow(/last row/);
  });

  test('removeRow removes the right index', () => {
    const l = createLayout([row([cell('a')]), row([cell('b')]), row([cell('c')])]);
    const next = removeRow(l, 1);
    expect(next.rows.map(r => r.cells[0]!.widgetInstanceId)).toEqual(['a', 'c']);
  });
});

describe('cell mutations', () => {
  test('addCell appends at end by default', () => {
    const l = createLayout([row([cell('a')])]);
    const next = addCell(l, 0, cell('b'));
    expect(next.rows[0]!.cells.map(c => c.widgetInstanceId)).toEqual(['a', 'b']);
  });

  test('removeCell blocks removing the last cell in a row', () => {
    const l = createLayout([row([cell('a')])]);
    expect(() => removeCell(l, 0, 0)).toThrow(/last cell/);
  });

  test('removeCell keeps row, drops one cell', () => {
    const l = createLayout([row([cell('a'), cell('b')])]);
    const next = removeCell(l, 0, 0);
    expect(next.rows[0]!.cells.map(c => c.widgetInstanceId)).toEqual(['b']);
  });
});

describe('widget placement', () => {
  test('placeWidget sets the id on the target cell', () => {
    const l = createLayout([row([cell(null)])]);
    const next = placeWidget(l, 0, 0, 'chart-1');
    expect(next.rows[0]!.cells[0]!.widgetInstanceId).toBe('chart-1');
  });

  test('placeWidget rejects duplicate id', () => {
    const l = createLayout([row([cell('a'), cell(null)])]);
    expect(() => placeWidget(l, 0, 1, 'a')).toThrow(/already placed/);
  });

  test('placeWidget rejects reserved id', () => {
    const l = emptyLayout();
    expect(() => placeWidget(l, 0, 0, '__log__')).toThrow(/reserved/);
  });

  test('placeWidget(null) clears the cell', () => {
    const l = createLayout([row([cell('a')])]);
    const next = placeWidget(l, 0, 0, null);
    expect(next.rows[0]!.cells[0]!.widgetInstanceId).toBeNull();
  });

  test('removeWidget clears its cell', () => {
    const l = createLayout([row([cell('a'), cell('b')])]);
    const next = removeWidget(l, 'a');
    expect(next.rows[0]!.cells[0]!.widgetInstanceId).toBeNull();
    expect(next.rows[0]!.cells[1]!.widgetInstanceId).toBe('b');
  });

  test('removeWidget is a no-op when id not present', () => {
    const l = createLayout([row([cell('a')])]);
    const next = removeWidget(l, 'ghost');
    expect(next).toBe(l);
  });
});

describe('resize', () => {
  test('resizeCell updates just the target cell width', () => {
    const l = createLayout([row([cell('a', 'flex'), cell('b', 'flex')])]);
    const next = resizeCell(l, 0, 0, 0.3);
    expect(next.rows[0]!.cells[0]!.width).toBe(0.3);
    expect(next.rows[0]!.cells[1]!.width).toBe('flex');
  });

  test('resizeRow updates just the target row height', () => {
    const l = createLayout([row([cell('a')], 'flex'), row([cell('b')], 'flex')]);
    const next = resizeRow(l, 1, 0.6);
    expect(next.rows[1]!.height).toBe(0.6);
    expect(next.rows[0]!.height).toBe('flex');
  });

  test('resize validates size', () => {
    const l = emptyLayout();
    expect(() => resizeCell(l, 0, 0, -1 as any)).toThrow(/> 0/);
  });
});

describe('modals', () => {
  const m = (id: string, widgetId: string): ModalPlacement => ({
    id, widgetInstanceId: widgetId, position: 'center',
  });

  test('openModal adds to the modals array', () => {
    const l = emptyLayout();
    const next = openModal(l, m('confirm', 'w1'));
    expect(next.modals).toHaveLength(1);
  });

  test('openModal rejects duplicate modal id', () => {
    const l = openModal(emptyLayout(), m('confirm', 'w1'));
    expect(() => openModal(l, m('confirm', 'w2'))).toThrow(/already open/);
  });

  test('closeModal removes by id, no-op when missing', () => {
    const l = openModal(emptyLayout(), m('confirm', 'w1'));
    const next = closeModal(l, 'confirm');
    expect(next.modals).toHaveLength(0);
    const again = closeModal(next, 'confirm');
    expect(again.modals).toHaveLength(0);
  });
});

describe('queries', () => {
  test('locate finds (row, col) of an id', () => {
    const l = createLayout([row([cell('a'), cell('b')]), row([cell('c')])]);
    expect(locate(l, 'b')).toEqual({ row: 0, col: 1 });
    expect(locate(l, 'c')).toEqual({ row: 1, col: 0 });
    expect(locate(l, 'nope')).toBeNull();
  });

  test('instanceIds returns grid + modals', () => {
    const l = openModal(
      createLayout([row([cell('a'), cell(null)]), row([cell('b')])]),
      { id: 'm1', widgetInstanceId: 'modal-w', position: 'center' },
    );
    expect(instanceIds(l)).toEqual(['a', 'b', 'modal-w']);
  });
});

describe('solveSizes', () => {
  test('all flex splits total evenly', () => {
    expect(solveSizes(['flex', 'flex', 'flex'], 30)).toEqual([10, 10, 10]);
  });

  test('fractions + flex — fractions take their share first', () => {
    expect(solveSizes([0.5, 'flex', 'flex'], 100)).toEqual([50, 25, 25]);
  });

  test('absolute int sizes are honored', () => {
    expect(solveSizes([20, 'flex'], 100)).toEqual([20, 80]);
  });

  test('n=1 means ONE row/col, not 100% fraction (regression guard)', () => {
    // Bit us in W3.4 — header got height:1 and swallowed the entire grid
    // because solveSizes was treating 1 as fraction. Must be absolute 1.
    expect(solveSizes([1, 'flex'], 10)).toEqual([1, 9]);
    expect(solveSizes([1, 1, 'flex'], 20)).toEqual([1, 1, 18]);
  });

  test('fractions strictly less than 1 still work', () => {
    expect(solveSizes([0.999, 'flex'], 100)).toEqual([99, 1]);
  });

  test('rounding leftovers land on a flex slot', () => {
    const r = solveSizes(['flex', 'flex', 'flex'], 31);
    expect(r.reduce((a, b) => a + b, 0)).toBe(31);
  });

  test('zero total → all zero', () => {
    expect(solveSizes(['flex', 'flex'], 0)).toEqual([0, 0]);
  });
});
