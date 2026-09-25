import { describe, expect, test } from 'bun:test';

import { createVwLocalInputTargetPopup } from '../src/virtual-windows/vw-local-input-target-popup.js';
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

describe('createVwLocalInputTargetPopup', () => {
  test('returns null when source window is unknown', () => {
    const { reg } = setup();
    const handle = createVwLocalInputTargetPopup({
      registry: reg,
      sourceWindowId: 999 as never,
      termCols: 120,
      termRows: 40,
      onPick: () => {},
    });
    expect(handle).toBe(null);
  });

  test('renders target rows for focused, all, and each pane', () => {
    const { reg } = setup();
    const win = reg.spawn({ title: 'showroom', initialContent: { kind: 'markdown', text: 'a', title: 'codex' } });
    win.splitFocused('h', {
      id: 'claude-pane',
      kind: 'markdown',
      title: 'claude',
      start() {},
      stop() {},
      render: () => '',
      onKey: () => ({ type: 'none' as const }),
      write() {},
      capture: () => '',
      get isAlive() { return true; },
      on: () => () => {},
    } as never);

    const handle = createVwLocalInputTargetPopup({
      registry: reg,
      sourceWindowId: win.id,
      termCols: 120,
      termRows: 40,
      onPick: () => {},
    });
    expect(handle).not.toBe(null);
    const paint = handle!.surface.paint();
    expect(paint).toContain('focused pane');
    expect(paint).toContain('all panes');
    expect(paint).toContain('claude');
    handle?.dispose();
  });

  test('controlled query and cursor are reflected, and change callbacks fire', () => {
    const { reg } = setup();
    const win = reg.spawn({ title: 'showroom', initialContent: { kind: 'markdown', text: 'a', title: 'codex' } });
    win.splitFocused('h', {
      id: 'claude-pane',
      kind: 'markdown',
      title: 'claude',
      start() {},
      stop() {},
      render: () => '',
      onKey: () => ({ type: 'none' as const }),
      write() {},
      capture: () => '',
      get isAlive() { return true; },
      on: () => () => {},
    } as never);
    let query = 'cla';
    let cursor = 0;
    const queries: string[] = [];
    const cursors: number[] = [];
    let picked: unknown = null;
    const handle = createVwLocalInputTargetPopup({
      registry: reg,
      sourceWindowId: win.id,
      termCols: 120,
      termRows: 40,
      query: () => query,
      cursor: () => cursor,
      onQueryChange: (next) => {
        query = next;
        queries.push(next);
      },
      onCursorChange: (next) => {
        cursor = next;
        cursors.push(next);
      },
      onPick: (target) => { picked = target; },
    });
    expect(handle).not.toBe(null);
    const paint = handle!.surface.paint();
    expect(paint).toContain('cla');
    expect(paint).toContain('claude');
    handle!.handleKey({ name: 'backspace' } as never);
    expect(queries.at(-1)).toBe('cl');
    handle!.handleKey({ name: 'down' } as never);
    expect(cursors.at(-1)).toBe(0);
    handle!.handleKey({ name: 'enter' } as never);
    expect(picked).not.toBe(null);
  });

  test('uses compact footer hint vocabulary on narrow widths', () => {
    const { reg } = setup();
    const win = reg.spawn({ title: 'showroom', initialContent: { kind: 'markdown', text: 'a', title: 'codex' } });
    win.splitFocused('h', {
      id: 'claude-pane',
      kind: 'markdown',
      title: 'claude',
      start() {},
      stop() {},
      render: () => '',
      onKey: () => ({ type: 'none' as const }),
      write() {},
      capture: () => '',
      get isAlive() { return true; },
      on: () => () => {},
    } as never);
    const handle = createVwLocalInputTargetPopup({
      registry: reg,
      sourceWindowId: win.id,
      termCols: 40,
      termRows: 20,
      onPick: () => {},
    });
    expect(handle).not.toBe(null);
    const paint = handle!.surface.paint();
    expect(paint).toContain('Dbl/↵ pick');
    expect(paint).not.toContain('Double-click/Enter pick');
    handle?.dispose();
  });
});
