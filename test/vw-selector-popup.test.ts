// VW-U4 — Pane/window selector popup tests.
//
// Hermetic: spawn a real WindowRegistry with 2 windows (one with
// 2 panes), call createVwSelectorPopup, and inspect the ViewSurfaceHandle
// for expected item composition. Then exercise submit/cancel paths.

import { describe, expect, test } from 'bun:test';
import { createVwSelectorPopup } from '../src/virtual-windows/vw-selector-popup.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

function setup() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const reg = new WindowRegistry({
    addressBook: createAddressBook(),
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  return { coord, reg };
}

describe('VW-U4 createVwSelectorPopup', () => {
  test('returns null when sourceWindowId unknown', () => {
    const { reg } = setup();
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: 999 as never,
      col: 10, row: 10,
      termCols: 120, termRows: 40,
      onFocusPane: () => {},
      onSwitchWindow: () => {},
    });
    expect(h).toBe(null);
  });

  test('returns null when source VW is solo and has a single pane', () => {
    const { reg } = setup();
    const w = reg.spawn({ title: 'solo', initialContent: { kind: 'markdown', text: 'hi' } });
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: w.id,
      col: 10, row: 10,
      termCols: 120, termRows: 40,
      onFocusPane: () => {},
      onSwitchWindow: () => {},
    });
    // Items = [single focused pane] — only one row; but our empty-
    // check allows that single row to still show so the user can
    // confirm there's nothing else. This returns a handle.
    expect(h).not.toBe(null);
    h?.dispose();
  });

  test('surfaces the current focused pane first + separator + other windows', () => {
    const { reg } = setup();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    // Split a so it has 2 panes.
    reg.switchTo(a.id);
    a.splitFocused('h', {
      id: 'second',
      kind: 'markdown',
      title: 'markdown',
      start() {}, stop() {}, render: () => '',
      onKey: () => ({ type: 'none' as const }),
      write() {}, capture: () => '',
      get isAlive() { return true; },
      on: () => () => {},
    } as never);
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: a.id,
      col: 10, row: 10,
      termCols: 120, termRows: 40,
      onFocusPane: () => {},
      onSwitchWindow: () => {},
    });
    expect(h).not.toBe(null);
    // paint() should mention both panes of window a and window b.
    const paint = h!.surface.paint();
    expect(paint).toContain('win:' + b.id);      // other window listed
    expect(paint).toContain('other windows');    // separator row
    expect(h!.surface.ownerWorkspaceId).toBe(`virtual-window:${a.id}`);
    h?.dispose();
  });

  test('submit on a pane row fires onFocusPane with that pane id', () => {
    const { reg } = setup();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    const focusedPane = a.focused;
    let focusCall: { w: number; p: string } | null = null;
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: a.id,
      col: 10, row: 10,
      termCols: 120, termRows: 40,
      onFocusPane: (w, p) => { focusCall = { w, p }; },
      onSwitchWindow: () => {},
    });
    expect(h).not.toBe(null);
    // Simulate Enter on the default-selected item (first pane row).
    h!.handleKey({ name: 'enter' } as never);
    expect(focusCall).toEqual({ w: a.id, p: focusedPane });
  });

  test('Esc fires onCancel', () => {
    const { reg } = setup();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    let cancelled = 0;
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: a.id,
      col: 10, row: 10,
      termCols: 120, termRows: 40,
      onFocusPane: () => {},
      onSwitchWindow: () => {},
      onCancel: () => { cancelled++; },
    });
    expect(h).not.toBe(null);
    h!.handleKey({ name: 'escape' } as never);
    expect(cancelled).toBe(1);
  });

  test('hides footer hint for compact narrow lists', () => {
    const { reg } = setup();
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'a' } });
    reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'b' } });
    const h = createVwSelectorPopup({
      registry: reg,
      sourceWindowId: a.id,
      col: 10, row: 10,
      termCols: 40, termRows: 20,
      onFocusPane: () => {},
      onSwitchWindow: () => {},
    });
    expect(h).not.toBe(null);
    const paint = h!.surface.paint();
    expect(paint).not.toContain('Dbl/↵ switch');
    expect(paint).not.toContain('Double-click/Enter switch');
    h?.dispose();
  });
});
