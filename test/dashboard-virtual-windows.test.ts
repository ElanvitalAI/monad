import { describe, expect, test, afterEach } from 'bun:test';

import {
  initDashboardVirtualWindows,
  getDashboardVirtualWindows,
  _resetDashboardVirtualWindowsForTesting,
} from '../src/dashboard/windowing/virtual-windows.js';
import {
  getDefaultAgentRoomRegistry,
  _resetDefaultAgentRoomRegistryForTesting,
} from '../src/agent-room/registry.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  dispatchWindowList,
  dispatchWindowCreate,
  dispatchPaneList,
  dispatchPaneCapture,
  _resetVirtualWindowToolsForTesting,
} from '../src/skills/tools/virtual-windows.js';

afterEach(() => {
  _resetDashboardVirtualWindowsForTesting();
  _resetVirtualWindowToolsForTesting();
  _resetDefaultAgentRoomRegistryForTesting();
});

function mk() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  return initDashboardVirtualWindows({
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
}

describe('initDashboardVirtualWindows', () => {
  test('returns registry/bus/book/router + wires getter singleton', () => {
    const vw = mk();
    expect(vw.registry).toBeDefined();
    expect(vw.bus).toBeDefined();
    expect(vw.book).toBeDefined();
    expect(vw.router).toBeDefined();
    expect(getDashboardVirtualWindows()).toBe(vw);
  });

  test('getter throws before init', () => {
    _resetDashboardVirtualWindowsForTesting();
    expect(() => getDashboardVirtualWindows()).toThrow(/not initialized/);
  });

  test('tools can enumerate windows created via registry', async () => {
    const vw = mk();
    vw.registry.spawn({
      title: 'probe',
      initialContent: { kind: 'markdown', text: 'hello' },
    });
    const list = await dispatchWindowList({});
    expect(list.output).toContain('win:1');
    expect(list.output).toContain('title="probe"');
  });

  test('WindowCreate via tool wiring produces a live window', async () => {
    mk();
    const res = await dispatchWindowCreate({
      title: 'created',
      content: { kind: 'markdown', text: 'body' },
    });
    expect(res.output).toContain('window_id=1');
    const panes = await dispatchPaneList({});
    expect(panes.output).toContain('win:1');
    expect(panes.output).toContain('kind=markdown');
  });

  test('PaneCapture resolves through the registered lookup', async () => {
    const vw = mk();
    const win = vw.registry.spawn({
      title: 'cap',
      initialContent: { kind: 'markdown', text: 'SNAPSHOT-TEXT' },
    });
    const cap = await dispatchPaneCapture({ pane_addr: `pane:${win.focused}` });
    expect(cap.output).toContain('kind=markdown');
    expect(cap.output).toContain('SNAPSHOT-TEXT');
  });

  test('registry lifecycle events promote onto the bus', () => {
    const vw = mk();
    const seen: string[] = [];
    vw.bus.subscribe({}, (ev) => { seen.push(ev.type); });
    vw.registry.spawn({
      title: 'a',
      initialContent: { kind: 'markdown', text: 'x' },
    });
    expect(seen).toContain('window:create');
    expect(seen).toContain('pane:create');
    expect(seen).toContain('window:switch');
  });

  test('T2-P3 — pane update events bridge to pane:output on the bus', () => {
    const vw = mk();
    const win = vw.registry.spawn({
      title: 'w',
      initialContent: { kind: 'scratch', title: 'notes' },
    });
    const events: Array<{ type: string; addr?: string; chunk?: string }> = [];
    vw.bus.subscribe({ types: ['pane:output'] }, (ev) => {
      if (ev.type === 'pane:output') {
        events.push({ type: ev.type, addr: ev.addr, chunk: ev.chunk });
      }
    });
    // scratch.write() triggers on('update') inside PaneContent.
    const pane = win.getPane(win.focused);
    pane?.write('new scratch body');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.addr).toBe(`pane:${win.focused}`);
  });

  test('T2-P3 — pane:close emitted via closePaneAt, bridge unsubs', async () => {
    const vw = mk();
    const win = vw.registry.spawn({
      title: 'w',
      initialContent: { kind: 'scratch' },
    });
    // Splitting adds a second pane so closePaneAt has something to
    // remove while keeping the window alive.
    const { createPaneContent } = await import('../src/virtual-windows/pane-content.js');
    const newPaneId = win.splitFocused('h', createPaneContent({ kind: 'scratch' }));
    const closedEvents: string[] = [];
    vw.bus.subscribe(
      { addrPrefix: `pane:${newPaneId}`, types: ['pane:close'] },
      (ev) => { closedEvents.push(ev.type); },
    );
    win.closePaneAt(newPaneId);
    expect(closedEvents).toContain('pane:close');
  });

  test('T2-P3 — output event with non-string payload is ignored', () => {
    const vw = mk();
    const win = vw.registry.spawn({
      title: 'w',
      initialContent: { kind: 'scratch' },
    });
    const pane = win.getPane(win.focused)!;
    const events: string[] = [];
    vw.bus.subscribe({ types: ['pane:output'] }, (ev) => {
      if (ev.type === 'pane:output') events.push(ev.chunk);
    });
    // scratch .write() triggers only 'update' (no 'output' with
    // string). We expect one empty-chunk event per write.
    pane.write('new body');
    expect(events.filter(c => c === '').length).toBeGreaterThan(0);
  });

  test('navigation router wired to the same registry', () => {
    const vw = mk();
    vw.registry.spawn({ title: 'a', initialContent: { kind: 'markdown', text: 'x' } });
    vw.registry.spawn({ title: 'b', initialContent: { kind: 'markdown', text: 'y' } });
    expect(vw.registry.current()?.title).toBe('b');
    // Ctrl+B then '1' → switch to first window (id=1).
    expect(vw.router.handleKey({ name: 'b', ctrl: true } as never)).toBe('armed');
    expect(vw.router.handleKey({ name: '1' } as never)).toBe('consumed');
    expect(vw.registry.current()?.title).toBe('a');
  });

  test('window close cascades into agent-room cleanup', async () => {
    const vw = mk();
    let disposed = 0;
    const reg = getDefaultAgentRoomRegistry();
    reg.register({
      id: 'room-1',
      windowId: 1,
      preset: 'two-split',
      members: [
        { sessionId: 's0', paneId: 'p0', brand: 'codex', launchedAt: 1 },
        { sessionId: 's1', paneId: 'p1', brand: 'claude', launchedAt: 2 },
      ],
      createdAt: 1,
      dispose: async () => {
        disposed += 1;
      },
    });
    const win = vw.registry.spawn({
      title: 'showroom',
      initialContent: { kind: 'markdown', text: 'x' },
    });
    expect(win.id).toBe(1);

    vw.registry.close(win.id);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(disposed).toBe(1);
    expect(reg.get('room-1')).toBeUndefined();
  });

  test('callbacks passed to init are forwarded to the router', () => {
    const coord = new DisplayCoordinator({ frameMs: 0 });
    let helped = 0;
    const vw = initDashboardVirtualWindows({
      coordinator: coord,
      callbacks: { onHelp: () => { helped++; } },
    });
    vw.registry.spawn({
      title: 'x',
      initialContent: { kind: 'markdown', text: 'h' },
    });
    expect(vw.router.handleKey({ name: 'b', ctrl: true } as never)).toBe('armed');
    expect(vw.router.handleKey({ name: '?' } as never)).toBe('consumed');
    expect(helped).toBe(1);
  });
});
