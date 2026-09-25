import { describe, expect, test } from 'bun:test';
import {
  buildPaneTitleMenu,
  buildPillMenu,
  buildSelectViewRowMenu,
  createContextMenuRegistry,
  wireRegistryToContextKeys,
  type Menu,
  type MenuPresenter,
  type MenuResult,
} from '../src/ui/context-menu-registry.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';

// A deterministic id generator for reproducible handle assertions.
function makeSeqId(): () => string {
  let n = 0;
  return () => {
    n++;
    return `handle-${n}`;
  };
}

/** Stub presenter that resolves whenever the test calls `advance`.
 *  Each showMenu receives a one-shot resolver pushed into `pending`. */
function makeStubPresenter(): {
  presenter: MenuPresenter;
  pending: Array<(result: MenuResult) => void>;
  calls: Array<{ menu: Menu; pos: { x: number; y: number } }>;
} {
  const pending: Array<(r: MenuResult) => void> = [];
  const calls: Array<{ menu: Menu; pos: { x: number; y: number } }> = [];
  return {
    pending,
    calls,
    presenter: (menu, pos) =>
      new Promise<MenuResult>((resolve) => {
        calls.push({ menu, pos });
        pending.push(resolve);
      }),
  };
}

describe('IDX-5 Phase 2 context-menu-registry — core', () => {
  test('registerMenu + getMenu return a clone (caller mutation is safe)', () => {
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    const menu: Menu = {
      title: 'T',
      items: [{ kind: 'command', id: 'x', label: 'X' }],
    };
    const handle = reg.registerMenu(menu);
    const read = reg.getMenu(handle);
    expect(read).not.toBeNull();
    expect(read!.items).toHaveLength(1);
    // Mutating the returned menu doesn't affect the registry.
    read!.items.push({ kind: 'separator' });
    const read2 = reg.getMenu(handle);
    expect(read2!.items).toHaveLength(1);
  });

  test('registerMenu returns a fresh handle per call', () => {
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    const h1 = reg.registerMenu({ items: [] });
    const h2 = reg.registerMenu({ items: [] });
    expect(h1).not.toBe(h2);
  });

  test('unregisterMenu evicts the entry', () => {
    const reg = createContextMenuRegistry();
    const h = reg.registerMenu({ items: [] });
    expect(reg.unregisterMenu(h)).toBe(true);
    expect(reg.getMenu(h)).toBeNull();
    expect(reg.unregisterMenu(h)).toBe(false);
  });

  test('updateMenu swaps content while keeping the handle', () => {
    const reg = createContextMenuRegistry();
    const h = reg.registerMenu({
      items: [{ kind: 'command', id: 'a', label: 'A' }],
    });
    reg.updateMenu(h, {
      items: [{ kind: 'command', id: 'b', label: 'B' }],
    });
    const menu = reg.getMenu(h)!;
    expect(menu.items).toHaveLength(1);
    expect((menu.items[0] as { id: string }).id).toBe('b');
  });

  test('updateMenu on unknown handle returns false', () => {
    const reg = createContextMenuRegistry();
    const result = reg.updateMenu('bogus' as never, { items: [] });
    expect(result).toBe(false);
  });
});

describe('IDX-5 Phase 2 context-menu-registry — showMenu lifecycle', () => {
  test('showMenu invokes the presenter and resolves with its result', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const handle = reg.registerMenu({
      items: [{ kind: 'command', id: 'copy', label: 'Copy' }],
    });
    const resultPromise = reg.showMenu(handle, { x: 10, y: 5 });
    // Presenter got the clone.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.pos).toEqual({ x: 10, y: 5 });
    expect(stub.calls[0]!.menu.items).toHaveLength(1);

    stub.pending[0]!({ value: 'copy', reason: 'selected' });
    const result = await resultPromise;
    expect(result).toEqual({ value: 'copy', reason: 'selected' });
  });

  test('showMenu on unknown handle resolves with disposed-null', async () => {
    const reg = createContextMenuRegistry();
    const result = await reg.showMenu('bogus' as never, { x: 0, y: 0 });
    expect(result).toEqual({ value: null, reason: 'disposed' });
  });

  test('isOpen + onOpenChange reflect the showMenu lifecycle', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const transitions: boolean[] = [];
    reg.onOpenChange((open) => transitions.push(open));
    expect(transitions).toEqual([false]); // primed with current state

    const handle = reg.registerMenu({ items: [] });
    const p = reg.showMenu(handle, { x: 0, y: 0 });
    expect(reg.isOpen).toBe(true);
    expect(transitions).toEqual([false, true]);

    stub.pending[0]!({ value: null, reason: 'escape' });
    await p;
    expect(reg.isOpen).toBe(false);
    expect(transitions).toEqual([false, true, false]);
  });

  test('nested showMenu calls stay `open` until the outer resolves', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const transitions: boolean[] = [];
    reg.onOpenChange((open) => transitions.push(open));
    const h1 = reg.registerMenu({ items: [] });
    const h2 = reg.registerMenu({ items: [] });
    const p1 = reg.showMenu(h1, { x: 0, y: 0 });
    const p2 = reg.showMenu(h2, { x: 1, y: 1 });
    expect(reg.isOpen).toBe(true);
    stub.pending[0]!({ value: null, reason: 'outside-click' });
    await p1;
    expect(reg.isOpen).toBe(true); // second still open
    stub.pending[1]!({ value: 'k', reason: 'selected' });
    await p2;
    expect(reg.isOpen).toBe(false);
    expect(transitions[transitions.length - 1]).toBe(false);
  });

  test('setPresenter swaps the rendering backend', async () => {
    const stub1 = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub1.presenter });
    const stub2 = makeStubPresenter();
    reg.setPresenter(stub2.presenter);
    const handle = reg.registerMenu({ items: [] });
    const p = reg.showMenu(handle, { x: 0, y: 0 });
    expect(stub1.calls).toHaveLength(0);
    expect(stub2.calls).toHaveLength(1);
    stub2.pending[0]!({ value: 'z', reason: 'selected' });
    const r = await p;
    expect(r.value).toBe('z');
  });

  test('setPresenter(null) falls back to a disposed-null presenter', async () => {
    const reg = createContextMenuRegistry();
    reg.setPresenter(null);
    const handle = reg.registerMenu({ items: [] });
    const result = await reg.showMenu(handle, { x: 0, y: 0 });
    expect(result.reason).toBe('disposed');
  });
});

describe('IDX-5 Phase 2 context-menu-registry — dispose', () => {
  test('dispose after showMenu start still lets the outer caller settle', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const handle = reg.registerMenu({ items: [] });
    const p = reg.showMenu(handle, { x: 0, y: 0 });
    reg.dispose();
    stub.pending[0]!({ value: null, reason: 'disposed' });
    const r = await p;
    expect(r.reason).toBe('disposed');
  });

  test('dispose rejects subsequent showMenu attempts', async () => {
    const reg = createContextMenuRegistry();
    reg.dispose();
    const handle = reg.registerMenu({ items: [] });
    const result = await reg.showMenu(handle, { x: 0, y: 0 });
    expect(result.reason).toBe('disposed');
  });
});

describe('IDX-5 Phase 2 — context-keys bridge', () => {
  test('wireRegistryToContextKeys mirrors open/close into contextMenuOpen', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const ctx = createContextKeyService();
    wireRegistryToContextKeys(reg, ctx);
    expect(ctx.keys.contextMenuOpen).toBe(false);

    const handle = reg.registerMenu({ items: [] });
    const p = reg.showMenu(handle, { x: 0, y: 0 });
    expect(ctx.keys.contextMenuOpen).toBe(true);
    stub.pending[0]!({ value: null, reason: 'escape' });
    await p;
    expect(ctx.keys.contextMenuOpen).toBe(false);
  });
});

describe('IDX-5 Phase 2 — 3-site builders', () => {
  test('buildPaneTitleMenu produces all four actions by default', () => {
    const menu = buildPaneTitleMenu({ paneId: 'chat' });
    const ids = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i as { id: string }).id);
    expect(ids).toEqual([
      'pane.close',
      'pane.rename',
      'pane.split.h',
      'pane.split.v',
      'pane.detach',
    ]);
    expect(menu.id).toBe('pane-title:chat');
    expect(menu.title).toBe('Pane');
  });

  test('buildPaneTitleMenu suppresses sections via opts flags', () => {
    const menu = buildPaneTitleMenu({
      paneId: 'chat',
      canSplit: false,
      canDetach: false,
    });
    const ids = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i as { id: string }).id);
    expect(ids).toEqual(['pane.close', 'pane.rename']);
  });

  test('buildSelectViewRowMenu truncates long row labels', () => {
    const long = 'x'.repeat(80);
    const menu = buildSelectViewRowMenu({ rowValue: 'v', rowLabel: long });
    expect(menu.title!.length).toBeLessThanOrEqual(40);
    expect(menu.title!.endsWith('…')).toBe(true);
  });

  test('buildSelectViewRowMenu produces copy / open / remove by default', () => {
    const menu = buildSelectViewRowMenu({ rowValue: 'v' });
    const ids = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i as { id: string }).id);
    expect(ids).toEqual(['row.copy', 'row.open', 'row.remove']);
  });

  test('buildPillMenu personalises title + labels with pillName', () => {
    const menu = buildPillMenu({ pillName: 'Model' });
    expect(menu.title).toBe('Model');
    expect(menu.id).toBe('pill:Model');
    const labels = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i as { label: string }).label);
    expect(labels).toContain('Switch Model…');
    expect(labels).toContain('Model settings…');
  });

  test('buildPillMenu omits Remove item by default', () => {
    const menu = buildPillMenu({ pillName: 'Mode' });
    const ids = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i as { id: string }).id);
    expect(ids).not.toContain('pill.remove');
  });

  test('buildPillMenu adds Remove item when canRemove=true', () => {
    const menu = buildPillMenu({ pillName: 'Model', canRemove: true });
    const items = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => i as { id: string; label: string });
    const remove = items.find((i) => i.id === 'pill.remove');
    expect(remove).toBeDefined();
    expect(remove!.label).toBe('Remove Model from rotation');
  });

  test('buildPillMenu uses removeLabel override', () => {
    const menu = buildPillMenu({
      pillName: 'Model',
      canRemove: true,
      removeLabel: 'Drop active rotation entry',
    });
    const remove = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => i as { id: string; label: string })
      .find((i) => i.id === 'pill.remove');
    expect(remove!.label).toBe('Drop active rotation entry');
  });
});

describe('IDX-5 Phase 2 — presenter round-trip via registry', () => {
  test('ergonomic usage: register a pane menu, showMenu, pick close', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const menu = buildPaneTitleMenu({ paneId: 'sessions' });
    const handle = reg.registerMenu(menu);
    const p = reg.showMenu(handle, { x: 12, y: 1 });
    // Simulate the user picking "Close pane".
    stub.pending[0]!({ value: 'pane.close', reason: 'selected' });
    const r = await p;
    expect(r).toEqual({ value: 'pane.close', reason: 'selected' });
  });

  test('pick can return null + outside-click reason', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({ presenter: stub.presenter });
    const h = reg.registerMenu(buildPillMenu({ pillName: 'Mode' }));
    const p = reg.showMenu(h, { x: 4, y: 2 });
    stub.pending[0]!({ value: null, reason: 'outside-click' });
    const r = await p;
    expect(r.value).toBeNull();
    expect(r.reason).toBe('outside-click');
  });
});
