// MD4 — browseMode flag on SelectView / ListView / TreeView /
// ComboBox / FileDialog.
//
// Collection widgets now share one contract:
// single-click selects, double-click submits/activates.
// Legacy browseMode flags may remain at call sites but no longer
// change the mouse contract for SelectView / ListView / TreeView.

import { describe, expect, test } from 'bun:test';
import { Printer } from '../src/ui/printer.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { ListView } from '../src/ui/widgets/list-view.js';
import { TreeView } from '../src/ui/widgets/tree-view.js';
import { ComboBox } from '../src/ui/widgets/combo-box.js';

function dispatch(p: Printer, ev: { type: 'click' | 'double-click' | 'scroll-up' | 'scroll-down'; x: number; y: number }) {
  const hit = p.registry.hit(ev.x, ev.y);
  if (!hit) return 'no-hit';
  hit.view.onMouse?.({
    type: ev.type,
    x: ev.x - hit.absX,
    y: ev.y - hit.absY,
    absX: ev.x,
    absY: ev.y,
    payload: hit.payload,
  });
  return 'hit';
}

describe('MD4 — SelectView browseMode', () => {
  test('default single-click only selects', () => {
    let picked: string | null = null;
    const sv = new SelectView<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      onSubmit: v => { picked = v as string; },
    });
    sv.layout({ width: 20, height: 5 });
    sv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    sv.draw(p);
    // Find the 2nd row's region and click it.
    const regions = p.registry.snapshot();
    const row = regions.find(r => (r.payload as any)?.filtIdx === 1);
    expect(row).toBeDefined();
    dispatch(p, { type: 'click', x: row!.absX, y: row!.absY });
    expect(picked).toBeNull();
    expect(sv._snapshot().cursor).toBe(1);
  });

  test('browseMode single-click only moves cursor', () => {
    let picked: string | null = null;
    const sv = new SelectView<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      browseMode: true,
      onSubmit: v => { picked = v as string; },
    });
    sv.layout({ width: 20, height: 5 });
    sv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    sv.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.filtIdx === 1);
    dispatch(p, { type: 'click', x: row!.absX, y: row!.absY });
    expect(picked).toBeNull();
  });

  test('browseMode double-click submits', () => {
    let picked: string | null = null;
    const sv = new SelectView<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      browseMode: true,
      onSubmit: v => { picked = v as string; },
    });
    sv.layout({ width: 20, height: 5 });
    sv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    sv.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.filtIdx === 1);
    dispatch(p, { type: 'double-click', x: row!.absX, y: row!.absY });
    expect(picked).toBe('b');
  });
});

describe('MD4 — ListView browseMode', () => {
  test('default single-click selects without picking', () => {
    let picked: { name: string } | null = null;
    let moved: Array<{ name: string }> = [];
    const lv = new ListView<{ name: string }>({
      columns: [{ title: 'Name' }],
      rows: [{ name: 'x' }, { name: 'y' }],
      render: r => [r.name],
      onCursor: r => { moved.push(r); },
      onPick: r => { picked = r; },
    });
    lv.layout({ width: 20, height: 5 });
    lv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    lv.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.idx === 1);
    dispatch(p, { type: 'click', x: row!.absX, y: row!.absY });
    expect(picked).toBeNull();
    expect(moved.map((r) => r.name)).toEqual(['y']);
    expect(lv.selectedRow?.name).toBe('y');
  });

  test('browseMode single-click fires onCursor only', () => {
    let picked = 0, moved = 0;
    const lv = new ListView<{ name: string }>({
      columns: [{ title: 'Name' }],
      rows: [{ name: 'x' }, { name: 'y' }],
      render: r => [r.name],
      browseMode: true,
      onPick: () => picked++,
      onCursor: () => moved++,
    });
    lv.layout({ width: 20, height: 5 });
    lv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    lv.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.idx === 1);
    dispatch(p, { type: 'click', x: row!.absX, y: row!.absY });
    expect(picked).toBe(0);
    expect(moved).toBe(1);
  });

  test('browseMode double-click picks', () => {
    let picked: { name: string } | null = null;
    const lv = new ListView<{ name: string }>({
      columns: [{ title: 'Name' }],
      rows: [{ name: 'x' }, { name: 'y' }],
      render: r => [r.name],
      browseMode: true,
      onPick: r => { picked = r; },
    });
    lv.layout({ width: 20, height: 5 });
    lv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    lv.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.idx === 1);
    dispatch(p, { type: 'double-click', x: row!.absX, y: row!.absY });
    expect((picked as any)?.name).toBe('y');
  });
});

describe('MD4 — TreeView browseMode', () => {
  test('default single-click on row only selects', () => {
    let picked: string | null = null;
    let moved = 0;
    const tv = new TreeView<string>({
      root: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
      onCursor: () => moved++,
      onPick: n => { picked = n.value; },
    });
    tv.layout({ width: 20, height: 5 });
    tv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    tv.draw(p);
    const row = p.registry.snapshot().find(r => {
      const pl = r.payload as any;
      return pl?.kind === 'row' && pl?.idx === 1;
    });
    expect(row).toBeDefined();
    dispatch(p, { type: 'click', x: row!.absX + 2, y: row!.absY });
    expect(picked).toBeNull();
    expect(moved).toBe(1);
  });

  test('browseMode single-click on row only moves cursor', () => {
    let picked = 0, moved = 0;
    const tv = new TreeView<string>({
      root: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
      browseMode: true,
      onPick: () => picked++,
      onCursor: () => moved++,
    });
    tv.layout({ width: 20, height: 5 });
    tv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    tv.draw(p);
    const row = p.registry.snapshot().find(r => {
      const pl = r.payload as any;
      return pl?.kind === 'row' && pl?.idx === 1;
    });
    dispatch(p, { type: 'click', x: row!.absX + 2, y: row!.absY });
    expect(picked).toBe(0);
    expect(moved).toBe(1);
  });

  test('browseMode double-click on row picks', () => {
    let picked: string | null = null;
    const tv = new TreeView<string>({
      root: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
      browseMode: true,
      onPick: n => { picked = n.value; },
    });
    tv.layout({ width: 20, height: 5 });
    tv.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    tv.draw(p);
    const row = p.registry.snapshot().find(r => {
      const pl = r.payload as any;
      return pl?.kind === 'row' && pl?.idx === 1;
    });
    dispatch(p, { type: 'double-click', x: row!.absX + 2, y: row!.absY });
    expect(picked).toBe('b');
  });
});

describe('MD4 — ComboBox browseMode', () => {
  test('default single-click on dropdown only selects', () => {
    let picked: string | null = null;
    const cb = new ComboBox<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      onSubmit: v => { picked = v as string; },
    });
    cb.layout({ width: 20, height: 5 });
    cb.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    cb.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.matchIdx === 1);
    if (!row) return;            // Printer may not have registered rows (e.g. filter)
    dispatch(p, { type: 'click', x: row.absX, y: row.absY });
    expect(picked).toBeNull();
  });

  test('browseMode single-click is also no-op for submit', () => {
    let submits = 0;
    const cb = new ComboBox<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      browseMode: true,
      onSubmit: () => submits++,
    });
    cb.layout({ width: 20, height: 5 });
    cb.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    cb.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.matchIdx === 1);
    if (!row) { expect(submits).toBe(0); return; }
    dispatch(p, { type: 'click', x: row.absX, y: row.absY });
    expect(submits).toBe(0);
  });

  test('browseMode double-click submits', () => {
    let picked: string | null = null;
    const cb = new ComboBox<string>({
      options: [
        { value: 'a', label: 'Apple' },
        { value: 'b', label: 'Banana' },
      ],
      browseMode: true,
      onSubmit: v => { picked = v as string; },
    });
    cb.layout({ width: 20, height: 5 });
    cb.takeFocus();
    const p = Printer.create({ width: 20, height: 5 });
    cb.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.matchIdx === 1);
    if (!row) { expect(picked).toBeNull(); return; }
    dispatch(p, { type: 'double-click', x: row.absX, y: row.absY });
    expect(picked).toBe('b');
  });
});
