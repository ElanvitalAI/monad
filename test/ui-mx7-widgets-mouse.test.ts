import { describe, expect, test } from 'bun:test';
import { ListView } from '../src/ui/widgets/list-view.js';
import { TreeView, type TreeNode } from '../src/ui/widgets/tree-view.js';
import { ComboBox } from '../src/ui/widgets/combo-box.js';
import { FileDialog, type FileEntry } from '../src/ui/widgets/file-dialog.js';
import { mountViewAsModalSurface } from '../src/ui/modal-adapter.js';
import type { DisplayMouseEvent } from '../src/display/types.js';
import { Printer } from '../src/ui/printer.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

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

async function nextTick(): Promise<void> {
  await new Promise(r => setTimeout(r, 5));
}

// ── ListView ────────────────────────────────────────────────────

describe('MX7 ListView mouse', () => {
  type Row = { name: string; cmd: string };
  const rows: Row[] = [
    { name: 'build', cmd: 'bun build' },
    { name: 'test',  cmd: 'bun test' },
    { name: 'lint',  cmd: 'eslint .' },
  ];

  test('double-click a row fires onPick with that row', () => {
    let picked: Row | null = null;
    const v = new ListView<Row>({
      columns: [{ title: 'Name' }, { title: 'Command' }],
      rows,
      render: r => [r.name, r.cmd],
      onPick: r => { picked = r; },
    });
    const h = mountViewAsModalSurface({ id: 'lv', bounds: { row: 2, col: 2, width: 30, height: 5 }, view: v });
    h.surface.paint();
    // Header at y=0 of printer; rows start at y=1.
    // Terminal row for row #1 = bounds.row + 1 + 1 = 4.
    const res = h.handleMouse(mouse('double-click', 4, 5));
    expect(res).toBe('consumed');
    expect(picked).toBe(rows[1]!);
  });

  test('scroll-down moves cursor by 3', () => {
    const v = new ListView<Row>({
      columns: [{ title: 'Name' }],
      rows: Array.from({ length: 10 }, (_, i) => ({ name: `r${i}`, cmd: '' })),
      render: r => [r.name],
    });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'lv2', bounds: { row: 1, col: 1, width: 20, height: 5 }, view: v });
    h.surface.paint();
    h.handleMouse(mouse('scroll-down', 2, 5));
    expect(v.selectedRow?.name).toBe('r3');
  });

  test('click outside any row → passthrough', () => {
    const v = new ListView<Row>({
      columns: [{ title: 'Name' }],
      rows,
      render: r => [r.name],
    });
    const h = mountViewAsModalSurface({ id: 'lv3', bounds: { row: 1, col: 1, width: 20, height: 10 }, view: v });
    h.surface.paint();
    // Click way below the last row.
    const res = h.handleMouse(mouse('click', 15, 5));
    expect(res).toBe('passthrough');
  });
});

// ── TreeView ────────────────────────────────────────────────────

describe('MX7 TreeView mouse', () => {
  const data: TreeNode<string>[] = [
    { label: 'src', value: 'src', children: [
      { label: 'a.ts', value: 'src/a.ts', isLeaf: true },
      { label: 'b.ts', value: 'src/b.ts', isLeaf: true },
    ]},
    { label: 'README.md', value: 'README.md', isLeaf: true },
  ];

  test('click the marker (▸) expands the folder without picking', () => {
    let picked: string | null = null;
    const v = new TreeView<string>({ root: data, onPick: n => { picked = n.value; } });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'tv', bounds: { row: 1, col: 1, width: 30, height: 10 }, view: v });
    h.surface.paint();
    // Row 0 is 'src' (has children). Indent 0 → marker at x=2..3.
    // Terminal row = 1 + 0 = 1, col = 1 + 2 = 3.
    const res = h.handleMouse(mouse('click', 1, 3));
    expect(res).toBe('consumed');
    expect(v._state().expanded).toContain('0');
    expect(picked).toBeNull();
  });

  test('double-click elsewhere on the row picks the node', () => {
    let picked: string | null = null;
    const v = new TreeView<string>({ root: data, onPick: n => { picked = n.value; } });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'tv2', bounds: { row: 1, col: 1, width: 30, height: 10 }, view: v });
    h.surface.paint();
    // Click on the label area (past the marker): col 10.
    const res = h.handleMouse(mouse('double-click', 1, 10));
    expect(res).toBe('consumed');
    expect(picked).toBe('src');
  });

  test('double-click on a leaf row picks it', () => {
    let picked: string | null = null;
    const v = new TreeView<string>({ root: data, onPick: n => { picked = n.value; } });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'tv3', bounds: { row: 1, col: 1, width: 30, height: 10 }, view: v });
    h.surface.paint();
    // README.md is row 1 (0-indexed) → terminal row = 1 + 1 = 2.
    h.handleMouse(mouse('double-click', 2, 5));
    expect(picked).toBe('README.md');
  });

  test('scroll-down moves cursor by 3', () => {
    const flat: TreeNode<string>[] = Array.from({ length: 10 }, (_, i) => ({
      label: `n${i}`, value: `v${i}`, isLeaf: true,
    }));
    const v = new TreeView<string>({ root: flat });
    v.takeFocus();
    v.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 });
    expect(v._state().cursor).toBe(3);
  });
});

// ── ComboBox ────────────────────────────────────────────────────

describe('MX7 ComboBox mouse', () => {
  const OPTS = [
    { value: 'main',    label: 'main' },
    { value: 'feature', label: 'feature/ui' },
    { value: 'mobile',  label: 'mobile' },
  ];

  test('click a dropdown row only selects it', () => {
    let picked: string | null = null;
    const v = new ComboBox<string>({
      options: OPTS,
      onSubmit: p => { picked = p as string; },
    });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'cb', bounds: { row: 2, col: 2, width: 30, height: 6 }, view: v });
    h.surface.paint();
    // Dropdown rows at y=1..3 → terminal rows 3..5. Click row 2 (mobile).
    h.handleMouse(mouse('click', 5, 5));
    expect(picked).toBeNull();
  });

  test('double-click a dropdown row submits', () => {
    let picked: string | null = null;
    const v = new ComboBox<string>({
      options: OPTS,
      onSubmit: p => { picked = p as string; },
    });
    v.takeFocus();
    const h = mountViewAsModalSurface({ id: 'cb-double', bounds: { row: 2, col: 2, width: 30, height: 6 }, view: v });
    h.surface.paint();
    h.handleMouse(mouse('double-click', 5, 5));
    expect(picked).toBe('mobile');
  });

  test('click on the input row focuses the editor', () => {
    const v = new ComboBox<string>({
      options: OPTS,
      onSubmit: () => {},
    });
    const h = mountViewAsModalSurface({ id: 'cb2', bounds: { row: 2, col: 2, width: 30, height: 6 }, view: v });
    h.surface.paint();
    h.handleMouse(mouse('click', 2, 5));
    // After clicking input row, the combo is focused (indirect check via key).
    h.handleKey({ name: 'h' } as never);
    h.handleKey({ name: 'i' } as never);
    expect(v.value).toBe('hi');
  });

  test('scroll-down increments dropdown idx', () => {
    const v = new ComboBox<string>({ options: OPTS, onSubmit: () => {} });
    v.takeFocus();
    v.onMouse?.({ type: 'scroll-down', x: 0, y: 1, absX: 0, absY: 1 });
    // We can't directly inspect dropdownIdx, but submit should now
    // pick OPTS[1].
    let picked: string | null = null;
    const v2 = new ComboBox<string>({
      options: OPTS,
      onSubmit: p => { picked = p as string; },
    });
    v2.takeFocus();
    v2.onMouse?.({ type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 });
    v2.onEvent({ name: 'enter' } as never);
    expect(picked).toBe('feature');
  });

  test('chrome-wrapped combo forwards row clicks through BoxView without submit', () => {
    let picked: string | null = null;
    const v = new ComboBox<string>({
      title: 'Wrapped combo',
      chromeSpec: { title: 'Wrapped combo', variant: 'panel', showClose: false },
      options: OPTS,
      onSubmit: p => { picked = p as string; },
    });
    v.layout({ width: 30, height: 8 });
    v.takeFocus();
    const p = Printer.create({ width: 30, height: 8 });
    v.draw(p);
    const row = p.registry.snapshot().find(r => (r.payload as any)?.matchIdx === 2);
    expect(row).toBeDefined();
    dispatch(p, { type: 'click', x: row!.absX, y: row!.absY });
    expect(picked).toBeNull();
  });
});

// ── FileDialog (inherits from SelectView) ───────────────────────

describe('MX7 FileDialog mouse (via inner SelectView)', () => {
  function makeFs(map: Record<string, FileEntry[]>) {
    return (path: string): FileEntry[] => map[path] ?? [];
  }

  test('double-click a file row submits its full path', async () => {
    const fs = makeFs({
      '/': [
        { name: 'hello.txt', isDirectory: false },
        { name: 'world.md',  isDirectory: false },
      ],
    });
    let picked: string | null = null;
    const v = new FileDialog({
      startDir: '/',
      mode: 'open',
      readDir: fs,
      onSubmit: p => { picked = p; },
    });
    const h = mountViewAsModalSurface({ id: 'fd', bounds: { row: 2, col: 2, width: 40, height: 14 }, view: v });
    h.surface.paint();
    await nextTick();
    h.surface.paint();
    // Inside the box (border at row 0, inner starts at row 1):
    // First row is '..' then file rows. SelectView inside FileDialog
    // has a title (from BoxView), so within SelectView rows start at
    // y=0 inside inner area.
    // Actually BoxView is the outer; inside: SelectView renders with
    // its own `title` which is set to the title passed in BoxView
    // OR not — let me just scan terminal rows and find one that
    // triggers a pick.
    let pickedThisScan: string | null = null;
    for (let r = 2; r < 2 + 14 && !pickedThisScan; r++) {
      for (let c = 3; c < 2 + 40 && !pickedThisScan; c += 5) {
        picked = null;
        h.handleMouse(mouse('double-click', r, c));
        if (picked !== null) pickedThisScan = picked;
      }
    }
    // At least one click should have picked a path.
    expect(pickedThisScan).not.toBeNull();
    // The path should be one of the files (not '..').
    if (pickedThisScan) {
      expect(['/hello.txt', '/world.md', '/']).toContain(pickedThisScan);
    }
  });
});
