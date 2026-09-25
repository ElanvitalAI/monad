// VW-B1 — window rename tests.
//
// Covers VirtualWindow.setTitle + WindowRegistry.renameWindow +
// NavigationRouter 'r' dispatch. Modal UI itself is tested via the
// rename modal's submit path (which re-uses EditView — covered by
// existing dialog tests).

import { describe, expect, test } from 'bun:test';
import { VirtualWindow } from '../src/virtual-windows/virtual-window.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { createNavigationRouter } from '../src/virtual-windows/navigation.js';

function setup() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  return { coord, reg, book };
}

describe('VW-B1 VirtualWindow.setTitle', () => {
  test('updates title in place', () => {
    const vw = new VirtualWindow({
      id: 1, title: 'orig',
      rootContent: createPaneContent({ kind: 'markdown', text: 'x', title: 'p' }),
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    expect(vw.title).toBe('orig');
    vw.setTitle('renamed');
    expect(vw.title).toBe('renamed');
  });
});

describe('VW-B1 WindowRegistry.renameWindow', () => {
  test('changes title + fires window:rename event + updates AddressBook', () => {
    const { reg, book } = setup();
    const events: string[] = [];
    reg.subscribe(ev => events.push(ev.type));
    const w = reg.spawn({ title: 'old', initialContent: { kind: 'markdown', text: 'x' } });
    const ok = reg.renameWindow(w.id, 'new title');
    expect(ok).toBe(true);
    expect(w.title).toBe('new title');
    expect(events).toContain('window:rename');
    expect(book.resolveWindow(w.id)?.title).toBe('new title');
  });

  test('rejects empty title after trim', () => {
    const { reg } = setup();
    const w = reg.spawn({ title: 'keep', initialContent: { kind: 'markdown', text: 'x' } });
    expect(reg.renameWindow(w.id, '   ')).toBe(false);
    expect(w.title).toBe('keep');
  });

  test('returns false for unknown window id', () => {
    const { reg } = setup();
    expect(reg.renameWindow(999 as never, 'x')).toBe(false);
  });
});

describe('VW-B2 VirtualWindow pane title override', () => {
  test('setPaneTitle stores override; getPaneDisplayTitle returns it', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'x', title: 'markdown' });
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    expect(vw.getPaneDisplayTitle(a.id)).toBe('markdown');
    expect(vw.setPaneTitle(a.id, 'notes')).toBe(true);
    expect(vw.getPaneDisplayTitle(a.id)).toBe('notes');
  });

  test('empty / whitespace title clears the override', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'x', title: 'markdown' });
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.setPaneTitle(a.id, 'tmp');
    expect(vw.getPaneDisplayTitle(a.id)).toBe('tmp');
    vw.setPaneTitle(a.id, '   ');
    expect(vw.getPaneDisplayTitle(a.id)).toBe('markdown');
  });

  test('closing the pane clears its override', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'x', title: 'a' });
    const b = createPaneContent({ kind: 'markdown', text: 'y', title: 'b' });
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    vw.splitFocused('h', b);
    vw.setPaneTitle(a.id, 'keep');
    vw.setPaneTitle(b.id, 'drop');
    vw.closePaneAt(b.id);
    // Re-using the same id would theoretically be ambiguous; we just
    // check the surviving override is intact and the dropped one is
    // cleared from the internal map (no external query — exposed via
    // getPaneDisplayTitle which returns '' for missing panes).
    expect(vw.getPaneDisplayTitle(a.id)).toBe('keep');
    expect(vw.getPaneDisplayTitle(b.id)).toBe('');
  });

  test('setPaneTitle returns false for unknown pane', () => {
    const a = createPaneContent({ kind: 'markdown', text: 'x', title: 'a' });
    const vw = new VirtualWindow({
      id: 1, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
    });
    expect(vw.setPaneTitle('nope', 'x')).toBe(false);
  });
});

describe('VW-B2 NavigationRouter onRenamePane', () => {
  test('Ctrl+B A fires onRenamePane', () => {
    const { reg } = setup();
    let calls = 0;
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onRenamePane: () => { calls++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    expect(router.handleKey({ name: 'a', shift: true })).toBe('consumed');
    expect(calls).toBe(1);
  });
});

describe('VW-B1 NavigationRouter onRenameWindow', () => {
  test('Ctrl+B r fires onRenameWindow', () => {
    const { reg } = setup();
    let calls = 0;
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onRenameWindow: () => { calls++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    expect(router.handleKey({ name: 'r' })).toBe('consumed');
    expect(calls).toBe(1);
  });

  test('Ctrl+B R (shift) also fires the same callback', () => {
    const { reg } = setup();
    let calls = 0;
    const router = createNavigationRouter({
      registry: reg,
      callbacks: { onRenameWindow: () => { calls++; } },
    });
    router.handleKey({ name: 'b', ctrl: true });
    // After coordinator lowercase matching, 'r' dispatches. We call
    // handleKey with name='r' shift=true to mirror how readKey reports
    // Shift+R on many terminals.
    expect(router.handleKey({ name: 'r', shift: true })).toBe('consumed');
    expect(calls).toBe(1);
  });
});
