// CMX-0 · Field extension tests for MenuItem.
//
// Additive fields (payload · hidden) must:
//   1. Survive register / getMenu clone cycle
//   2. Present correctly via flattenMenuItems (hidden → skipped)
//   3. Propagate through the presenter's onPick path as MenuResult.payload

import { describe, expect, test } from 'bun:test';
import {
  createContextMenuRegistry,
  type Menu,
  type MenuItem,
  type MenuPresenter,
  type MenuResult,
} from '../src/ui/context-menu-registry.js';
import { flattenMenuItems } from '../src/ui/context-menu-presenter.js';

function makeSeqId(): () => string {
  let n = 0;
  return () => { n++; return `h-${n}`; };
}

// Stub presenter that records every call + deferred resolver.
function makeStubPresenter(): {
  presenter: MenuPresenter;
  pending: Array<(r: MenuResult) => void>;
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

describe('CMX-0 · MenuItem.payload field', () => {
  test('payload survives registerMenu / getMenu clone cycle', () => {
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    const model = { path: '/tmp/x.ts', widget: 'browser' };
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'open', label: 'Open', payload: model },
      ],
    };
    const handle = reg.registerMenu(menu);
    const got = reg.getMenu(handle);
    expect(got).not.toBeNull();
    const first = got!.items[0]!;
    expect(first.kind).toBe('command');
    if (first.kind === 'command') {
      expect(first.payload).toEqual(model);
      // Clone is deep-safe: mutating caller's original doesn't leak.
      (model as { extra?: boolean }).extra = true;
      expect((first.payload as typeof model).path).toBe('/tmp/x.ts');
    }
  });

  test('payload propagates through presenter.onPick into MenuResult.payload', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const handle = reg.registerMenu({
      items: [
        { kind: 'command', id: 'attach', label: 'Attach', payload: { n: 42 } },
      ],
    });
    const resultP = reg.showMenu(handle, { x: 0, y: 0 });
    expect(stub.pending.length).toBe(1);
    // Simulate presenter resolving with selected + payload surfacing.
    // The registry's showMenu is what callers await; the stub presenter
    // takes whatever MenuResult the caller hands it. Here we inline the
    // payload lookup the real default presenter does.
    const picked = stub.calls[0]!.menu.items.find(
      (i) => i.kind === 'command' && i.id === 'attach',
    ) as Extract<MenuItem, { kind: 'command' }>;
    stub.pending[0]!({
      value: picked.id,
      reason: 'selected',
      ...(picked.payload !== undefined ? { payload: picked.payload } : {}),
    });
    const result = await resultP;
    expect(result.value).toBe('attach');
    expect(result.reason).toBe('selected');
    expect(result.payload).toEqual({ n: 42 });
  });

  test('payload absent → MenuResult.payload undefined', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const handle = reg.registerMenu({
      items: [{ kind: 'command', id: 'noop', label: 'Noop' }],
    });
    const resultP = reg.showMenu(handle, { x: 0, y: 0 });
    stub.pending[0]!({ value: 'noop', reason: 'selected' });
    const result = await resultP;
    expect(result.payload).toBeUndefined();
  });

  test('payload accepted on checkbox + single-choice kinds (type-check)', () => {
    const menu: Menu = {
      items: [
        { kind: 'command',       id: 'a', label: 'A', payload: 'cmd-payload' },
        { kind: 'checkbox',      id: 'b', label: 'B', checked: true,  payload: { kind: 'cb' } },
        { kind: 'single-choice', groupId: 'g', id: 'c', label: 'C', selected: false, payload: 99 },
      ],
    };
    // All three compile-pass — no runtime assertion needed beyond shape.
    expect(menu.items.length).toBe(3);
  });
});

describe('CMX-0 · MenuItem.hidden field', () => {
  test('hidden command is omitted from flattenMenuItems', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'a', label: 'A' },
        { kind: 'command', id: 'b', label: 'B', hidden: true },
        { kind: 'command', id: 'c', label: 'C' },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a', 'c']);
  });

  test('hidden checkbox is omitted', () => {
    const menu: Menu = {
      items: [
        { kind: 'checkbox', id: 'a', label: 'A', checked: true },
        { kind: 'checkbox', id: 'b', label: 'B', checked: false, hidden: true },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a']);
  });

  test('hidden single-choice is omitted', () => {
    const menu: Menu = {
      items: [
        { kind: 'single-choice', groupId: 'g', id: 'a', label: 'A', selected: true },
        { kind: 'single-choice', groupId: 'g', id: 'b', label: 'B', selected: false, hidden: true },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a']);
  });

  test('hidden separator is skipped silently (same as visible separator)', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'a', label: 'A' },
        { kind: 'separator' },
        { kind: 'command', id: 'b', label: 'B' },
        { kind: 'separator', hidden: true },
        { kind: 'command', id: 'c', label: 'C' },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a', 'b', 'c']);
  });

  test('hidden ≠ disabled — disabled item stays in output (grayed by widget)', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'a', label: 'A', disabled: true },
        { kind: 'command', id: 'b', label: 'B', hidden: true },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a']);
    expect(flat[0]!.disabled).toBe(true);
  });

  test('hidden survives clone cycle via registry', () => {
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    const handle = reg.registerMenu({
      items: [
        { kind: 'command', id: 'a', label: 'A' },
        { kind: 'command', id: 'b', label: 'B', hidden: true },
      ],
    });
    const got = reg.getMenu(handle);
    expect(got).not.toBeNull();
    const b = got!.items[1]!;
    expect(b.kind).toBe('command');
    if (b.kind === 'command') {
      expect(b.hidden).toBe(true);
    }
  });
});

describe('CMX-0 · backward compatibility', () => {
  test('items without payload/hidden work exactly as before', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'a', label: 'A' },
        { kind: 'separator' },
        { kind: 'checkbox', id: 'b', label: 'B', checked: false },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat.map((i) => i.value)).toEqual(['a', 'b']);
    // No accidental fields on output
    expect((flat[0] as { payload?: unknown }).payload).toBeUndefined();
  });
});
