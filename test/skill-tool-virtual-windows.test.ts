import { afterEach, describe, expect, test } from 'bun:test';

import {
  dispatchWindowList,
  dispatchWindowCreate,
  dispatchWindowSwitch,
  dispatchWindowClose,
  dispatchPaneList,
  dispatchPaneSplit,
  dispatchPaneFocus,
  dispatchPaneClose,
  dispatchPaneCapture,
  dispatchPaneInject,
  dispatchBroadcast,
  dispatchSubscribe,
  dispatchVWCollect,
  dispatchVWUnsubscribe,
  buildWindowListTool,
  buildPaneSplitTool,
  buildBroadcastTool,
  _resetVirtualWindowToolsForTesting,
} from '../src/skills/tools/virtual-windows.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createVWEventBus } from '../src/virtual-windows/event-bus.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { registerPaneContentLookup } from '../src/virtual-windows/pane-capture.js';

function harness() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const registry = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  const bus = createVWEventBus({ addressBook: book, writePane: () => {} });
  // Keys match VWToolDeps so each dispatch picks up the right
  // singletons without any extra wiring.
  return { coord, book, registry, bus, addressBook: book, eventBus: bus };
}

afterEach(() => {
  _resetVirtualWindowToolsForTesting();
  registerPaneContentLookup(() => null);
});

describe('schemas', () => {
  test('tool names are present', () => {
    expect(buildWindowListTool().name).toBe('WindowList');
    expect(buildPaneSplitTool().name).toBe('PaneSplit');
    expect(buildBroadcastTool().name).toBe('BroadcastPanes');
  });
});

describe('window lifecycle tools', () => {
  test('create + list + switch + close', async () => {
    const h = harness();
    const c1 = await dispatchWindowCreate(
      { title: 'alpha', content: { kind: 'markdown', text: 'x' } },
      h,
    );
    expect(c1.output).toMatch(/window_id=1/);
    const c2 = await dispatchWindowCreate(
      { title: 'beta', content: { kind: 'markdown', text: 'y' } },
      h,
    );
    expect(c2.output).toMatch(/window_id=2/);
    const list = await dispatchWindowList({}, h);
    expect(list.output).toContain('win:1');
    expect(list.output).toContain('win:2');
    const sw = await dispatchWindowSwitch({ id: 1 }, h);
    expect(sw.output).toMatch(/win:1/);
    expect(h.registry.current()?.id).toBe(1);
    await dispatchWindowClose({ id: 1 }, h);
    expect(h.registry.get(1)).toBeNull();
  });

  test('create missing content rejects', async () => {
    const h = harness();
    await expect(dispatchWindowCreate({ title: 'x' }, h)).rejects.toThrow(/content/);
  });

  test('switch unknown id rejects', async () => {
    const h = harness();
    await expect(dispatchWindowSwitch({ id: 99 }, h)).rejects.toThrow(/no window/);
  });
});

describe('pane lifecycle tools', () => {
  test('list includes focused marker + kinds', async () => {
    const h = harness();
    h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const r = await dispatchPaneList({}, h);
    expect(r.output).toContain('focused');
    expect(r.output).toContain('kind=markdown');
  });

  test('split creates a new pane + returns its addr', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const root = win.focused;
    const r = await dispatchPaneSplit(
      { pane_addr: `pane:${root}`, axis: 'h', content: { kind: 'markdown', text: 'b' } },
      h,
    );
    expect(r.output).toMatch(/PaneSplit pane:/);
    expect(win.listPanes()).toHaveLength(2);
  });

  test('split too-small rejects', async () => {
    const h = harness();
    h.registry.spawn({
      title: 'w',
      initialContent: { kind: 'markdown', text: 'a' },
      bounds: { row: 1, col: 1, width: 30, height: 10 },
    });
    const win = h.registry.current()!;
    const root = win.focused;
    await expect(dispatchPaneSplit(
      { pane_addr: `pane:${root}`, axis: 'h', content: { kind: 'markdown', text: 'b' } },
      h,
    )).rejects.toThrow(/too-small/);
  });

  test('focus by direction moves within window', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const root = win.focused;
    await dispatchPaneSplit(
      { pane_addr: `pane:${root}`, axis: 'h', content: { kind: 'markdown', text: 'b' } },
      h,
    );
    // Focus is now on b. Move left.
    const r = await dispatchPaneFocus({ direction: 'left' }, h);
    expect(r.output).toContain('ok=true');
    expect(win.focused).toBe(root);
  });

  test('focus by pane_addr', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const r = await dispatchPaneFocus({ pane_addr: `pane:${win.focused}` }, h);
    expect(r.output).toContain('ok=true');
  });

  test('close pane', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const root = win.focused;
    const { createPaneContent } = await import('../src/virtual-windows/pane-content.js');
    const b = createPaneContent({ kind: 'markdown', text: 'b' });
    win.splitFocused('h', b);
    const r = await dispatchPaneClose({ pane_addr: `pane:${b.id}` }, h);
    expect(r.output).toContain('ok=true');
    expect(win.listPanes()).toHaveLength(1);
    expect(win.listPanes()[0]!.id).toBe(root);
  });
});

describe('capture + inject + broadcast', () => {
  test('capture returns body for markdown pane', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'PAYLOAD' } });
    registerPaneContentLookup((id) => {
      const p = win.getPane(id);
      return p ? { capture: () => p.capture() } : null;
    });
    const r = await dispatchPaneCapture({ pane_addr: `pane:${win.focused}`, mode: 'text' }, h);
    expect(r.output).toContain('PAYLOAD');
  });

  test('inject writes to pane content (approver grants)', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    const grants: Array<{ paneAddr: string; totalBytes: number }> = [];
    await dispatchPaneInject(
      { pane_addr: `pane:${win.focused}`, bytes: 'injected' },
      { ...h, injectApprover: async (req) => { grants.push(req); return true; } },
    );
    expect(win.getPane(win.focused)?.capture()).toBe('injected');
    expect(grants).toHaveLength(1);
    expect(grants[0]!.totalBytes).toBe(8);
  });

  test('inject refuses when no approver is wired (fail-closed)', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    await expect(
      dispatchPaneInject({ pane_addr: `pane:${win.focused}`, bytes: 'x' }, h),
    ).rejects.toThrow(/no approver/);
  });

  test('inject aborts when approver rejects', async () => {
    const h = harness();
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'scratch' } });
    await expect(
      dispatchPaneInject(
        { pane_addr: `pane:${win.focused}`, bytes: 'x' },
        { ...h, injectApprover: async () => false },
      ),
    ).rejects.toThrow(/rejected by user/);
    expect(win.getPane(win.focused)?.capture()).toBe('');
  });

  test('broadcast fans out to multiple panes (approver grants)', async () => {
    const h = harness();
    const writes: Array<[string, string]> = [];
    const bus = createVWEventBus({ addressBook: h.book, writePane: (id, b) => writes.push([id, b]) });
    const win = h.registry.spawn({ title: 'w', initialContent: { kind: 'markdown', text: 'a' } });
    const { createPaneContent } = await import('../src/virtual-windows/pane-content.js');
    win.splitFocused('h', createPaneContent({ kind: 'markdown', text: 'b' }));
    const panes = win.listPanes();
    const r = await dispatchBroadcast(
      { targets: panes.map(p => `pane:${p.id}`), bytes: 'hi' },
      { ...h, eventBus: bus, broadcastApprover: async () => true },
    );
    expect(r.output).toMatch(/sent=2\/2/);
    expect(writes).toHaveLength(2);
  });

  test('broadcast refuses when no approver is wired', async () => {
    const h = harness();
    await expect(
      dispatchBroadcast({ targets: ['pane:a'], bytes: 'x' }, h),
    ).rejects.toThrow(/no approver/);
  });

  test('broadcast reports failures for unknown addrs (after approval)', async () => {
    const h = harness();
    const r = await dispatchBroadcast(
      { targets: ['pane:ghost'], bytes: 'x' },
      { ...h, broadcastApprover: async () => true },
    );
    expect(r.output).toMatch(/sent=0\/1/);
    expect(r.output).toContain('pane:ghost');
  });
});

describe('subscribe / collect / unsubscribe', () => {
  test('subscribe stores events + collect drains them', async () => {
    const h = harness();
    const sub = await dispatchSubscribe({ types: ['window:create'] }, h);
    const id = sub.output.match(/subscription_id=(\S+)/)?.[1];
    expect(id).toBeTruthy();
    // Trigger a window:create event.
    h.bus.emit({ type: 'window:create', windowId: 99, title: 'emitted' });
    const collected = await dispatchVWCollect({ subscription_id: id }, h);
    expect(collected.output).toContain('events=1');
    // Drain again — should be empty.
    const again = await dispatchVWCollect({ subscription_id: id }, h);
    expect(again.output).toContain('events=0');
    const off = await dispatchVWUnsubscribe({ subscription_id: id }, h);
    expect(off.output).toContain('VWUnsubscribe');
  });
});
