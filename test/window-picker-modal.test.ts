import { describe, expect, test } from 'bun:test';

import { createWindowPickerModal } from '../src/window-picker-modal.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import type { VirtualWindow } from '../src/virtual-windows/virtual-window.js';

function makeRegistry() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  return new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
}

function bounds() {
  return { row: 5, col: 5, width: 50, height: 10 };
}

describe('createWindowPickerModal', () => {
  test('empty registry → picker starts with no items', () => {
    const reg = makeRegistry();
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 50,
      onAccept: () => {},
    });
    expect(picker.state().items).toEqual([
      {
        label: '  ● Main',
        payload: 'main',
      },
    ]);
  });

  test('lists every window with the initial picker selection marker', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    reg.spawn({ title: 'beta',  initialContent: { kind: 'markdown', text: 'b' } });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    const labels = picker.state().items.map(i => i.label);
    expect(labels.length).toBe(3);
    expect(labels.some(l => l.includes('Main'))).toBe(true);
    expect(labels.some(l => l.includes('alpha'))).toBe(true);
    expect(labels.some(l => l.includes('beta'))).toBe(true);
    const mainLabel = labels.find(l => l.includes('Main'))!;
    expect(mainLabel).toContain('●');
  });

  test('query filters by substring in title', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'build-log', initialContent: { kind: 'markdown', text: '' } });
    reg.spawn({ title: 'notes',     initialContent: { kind: 'markdown', text: '' } });
    reg.spawn({ title: 'build-err', initialContent: { kind: 'markdown', text: '' } });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    'build'.split('').forEach(ch => picker.type(ch));
    const labels = picker.state().items.map(i => i.label);
    expect(picker.state().query).toBe('build');
    expect(labels.length).toBe(2);
    expect(labels.every(l => l.toLowerCase().includes('build'))).toBe(true);
    const ansi = picker.surface.paint();
    expect(ansi).toContain('Switch');
    expect(ansi).toContain('Cancel');
  });

  test('accept can target dashboard main', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    let picked: VirtualWindow | 'main' | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: (w) => { picked = w; },
    });
    picker.accept();
    expect(picked).toBe('main');
  });

  test('accept invokes onAccept with the resolved window', () => {
    const reg = makeRegistry();
    const w1 = reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    reg.spawn({ title: 'beta', initialContent: { kind: 'markdown', text: 'b' } });
    let picked: VirtualWindow | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: (w) => { picked = w; },
    });
    picker.down();
    picker.accept();
    expect(picked).toBe(w1);
  });

  test('cancel calls onCancel', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    let cancelled = 0;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
      onCancel: () => { cancelled++; },
    });
    picker.cancel();
    expect(cancelled).toBe(1);
  });

  test('accept on main-only list targets dashboard main', () => {
    const reg = makeRegistry();
    let picked: VirtualWindow | 'main' | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: (value) => { picked = value; },
    });
    picker.accept();
    expect(picked).toBe('main');
  });

  test('long title is truncated with ellipsis', () => {
    const reg = makeRegistry();
    reg.spawn({
      title: 'x'.repeat(40),
      initialContent: { kind: 'markdown', text: '' },
    });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    const label = picker.state().items.find((item) => String(item.payload) !== 'main')!.label;
    expect(label).toContain('…');
  });

  test('window labels stay compact and omit pane-count suffixes', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'solo', initialContent: { kind: 'markdown', text: 'a' } });
    const picker = createWindowPickerModal({
      registry: reg, bounds: bounds(), width: 60, onAccept: () => {},
    });
    const label = picker.state().items.find((item) => String(item.payload) !== 'main')!.label;
    expect(label).toContain('solo');
    expect(label).not.toContain('pane');
  });

  test('paint stays within picker bounds and does not clear the full terminal row', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 60,
      onAccept: () => {},
    });
    const ansi = picker.surface.paint();
    expect(ansi).not.toContain('\x1b[2K');
  });

  test('small picker disables filtering and shows action buttons', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 44,
      onAccept: () => {},
    });
    const ansi = picker.surface.paint();
    expect(ansi).toContain('Windows');
    expect(ansi).toContain('Switch');
    expect(ansi).toContain('Cancel');
    picker.type('x');
    expect(picker.state().query).toBe('x');
  });

  test('single-click selects an item without accepting it', () => {
    const reg = makeRegistry();
    const alpha = reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    let picked: VirtualWindow | 'main' | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 44,
      onAccept: (value) => { picked = value; },
    });
    picker.surface.paint();
    const b = picker.surface.bounds;
    const res = picker.surface.onMouse?.({ type: 'click', row: b.row + 3, col: b.col + 3 });
    expect(res?.type).toBe('refresh');
    expect(picked).toBeNull();
    expect(picker.state().selectedIdx).toBe(1);
    picker.accept();
    expect(picked).toBe(alpha);
  });

  test('selection glyph follows the current picker focus', () => {
    const reg = makeRegistry();
    reg.spawn({ title: 'ACP', initialContent: { kind: 'markdown', text: 'a' } });
    reg.spawn({ title: 'Simulator', initialContent: { kind: 'markdown', text: 'b' } });
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 44,
      onAccept: () => {},
    });
    let ansi = picker.surface.paint();
    expect(ansi).toContain('● Main');
    expect(ansi).toContain('○ ACP');
    picker.down();
    ansi = picker.surface.paint();
    expect(ansi).toContain('○ Main');
    expect(ansi).toContain('● ACP');
  });

  test('double-click activates the selected item', () => {
    const reg = makeRegistry();
    const alpha = reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    let picked: VirtualWindow | 'main' | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 44,
      onAccept: (value) => { picked = value; },
    });
    picker.surface.paint();
    const b = picker.surface.bounds;
    const res = picker.surface.onMouse?.({ type: 'double-click', row: b.row + 3, col: b.col + 3 });
    expect(res?.type).toBe('refresh');
    expect(picked).toBe(alpha);
  });

  test('primary action button accepts the current selection', () => {
    const reg = makeRegistry();
    const alpha = reg.spawn({ title: 'alpha', initialContent: { kind: 'markdown', text: 'a' } });
    let picked: VirtualWindow | 'main' | null = null;
    const picker = createWindowPickerModal({
      registry: reg,
      bounds: bounds(),
      width: 44,
      onAccept: (value) => { picked = value; },
    });
    picker.surface.paint();
    const b = picker.surface.bounds;
    picker.surface.onMouse?.({ type: 'click', row: b.row + 3, col: b.col + 3 });
    const res = picker.surface.onMouse?.({ type: 'click', row: b.row + b.height - 2, col: b.col + 15 });
    expect(res?.type).toBe('refresh');
    expect(picked).toBe(alpha);
  });
});
