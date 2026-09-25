// CMX-3 · Predicate-based `disabled` tests.
//
// `MenuItem.disabled` may be `boolean | ((ctx) => boolean)`. The
// predicate evaluates at flatten time against `ShowMenuOptions.context`.
// Static boolean callers are unaffected.

import { describe, expect, test } from 'bun:test';
import {
  createContextMenuRegistry,
  type Menu,
  type MenuEvalContext,
  type MenuPresenter,
  type MenuResult,
} from '../src/ui/context-menu-registry.js';
import { flattenMenuItems } from '../src/ui/context-menu-presenter.js';

function makeSeqId(): () => string {
  let n = 0;
  return () => { n++; return `h-${n}`; };
}

function makeStubPresenter(): {
  presenter: MenuPresenter;
  calls: Array<{ menu: Menu; pos: { x: number; y: number }; opts?: { context?: MenuEvalContext } }>;
  resolvers: Array<(r: MenuResult) => void>;
} {
  const calls: Array<{ menu: Menu; pos: { x: number; y: number }; opts?: { context?: MenuEvalContext } }> = [];
  const resolvers: Array<(r: MenuResult) => void> = [];
  return {
    calls,
    resolvers,
    presenter: (menu, pos, opts) =>
      new Promise<MenuResult>((resolve) => {
        calls.push({ menu, pos, opts });
        resolvers.push(resolve);
      }),
  };
}

describe('CMX-3 · MenuItem.disabled as predicate · flattenMenuItems', () => {
  test('static boolean disabled still works (backward-compat)', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'a', label: 'A', disabled: true },
        { kind: 'command', id: 'b', label: 'B', disabled: false },
        { kind: 'command', id: 'c', label: 'C' },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat[0]!.disabled).toBe(true);
    expect(flat[1]!.disabled).toBe(false);
    expect(flat[2]!.disabled).toBe(false);  // undefined → false
  });

  test('predicate returning true → disabled=true', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'paste', label: 'Paste', disabled: (ctx) => !ctx.hasClipboard },
      ],
    };
    const flat = flattenMenuItems(menu, { hasClipboard: false });
    expect(flat[0]!.disabled).toBe(true);
  });

  test('predicate returning false → disabled=false', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'paste', label: 'Paste', disabled: (ctx) => !ctx.hasClipboard },
      ],
    };
    const flat = flattenMenuItems(menu, { hasClipboard: true });
    expect(flat[0]!.disabled).toBe(false);
  });

  test('predicate with no ctx argument → defaults to empty record', () => {
    // flattenMenuItems() without ctx falls back to {} — predicate reads
    // undefined properties, treats them as missing.
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'save', label: 'Save', disabled: (ctx) => Boolean(ctx.readonly) },
      ],
    };
    const flat = flattenMenuItems(menu);
    expect(flat[0]!.disabled).toBe(false);
  });

  test('predicate throwing → treated as disabled (fail-safe)', () => {
    const buggy = (_ctx: MenuEvalContext): boolean => {
      throw new Error('boom');
    };
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'x', label: 'X', disabled: buggy },
      ],
    };
    const flat = flattenMenuItems(menu, {});
    // Error swallowed · disabled resolved to true (safe default).
    expect(flat[0]!.disabled).toBe(true);
  });

  test('predicate on checkbox kind', () => {
    const menu: Menu = {
      items: [
        { kind: 'checkbox', id: 'auto', label: 'Auto-save', checked: true,
          disabled: (ctx) => !!ctx.offlineMode },
      ],
    };
    const onlineFlat = flattenMenuItems(menu, { offlineMode: false });
    const offlineFlat = flattenMenuItems(menu, { offlineMode: true });
    expect(onlineFlat[0]!.disabled).toBe(false);
    expect(offlineFlat[0]!.disabled).toBe(true);
  });

  test('predicate on single-choice kind', () => {
    const menu: Menu = {
      items: [
        { kind: 'single-choice', groupId: 'g', id: 'a', label: 'A', selected: true,
          disabled: (ctx) => ctx.lockGroup === 'g' },
        { kind: 'single-choice', groupId: 'g', id: 'b', label: 'B', selected: false,
          disabled: (ctx) => ctx.lockGroup === 'g' },
      ],
    };
    const unlocked = flattenMenuItems(menu, { lockGroup: null });
    const locked = flattenMenuItems(menu, { lockGroup: 'g' });
    expect(unlocked[0]!.disabled).toBe(false);
    expect(unlocked[1]!.disabled).toBe(false);
    expect(locked[0]!.disabled).toBe(true);
    expect(locked[1]!.disabled).toBe(true);
  });

  test('predicate receives exactly the ctx passed in', () => {
    let captured: MenuEvalContext | null = null;
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'x', label: 'X', disabled: (ctx) => {
          captured = ctx;
          return false;
        } },
      ],
    };
    const ctx = { selection: 'abc', count: 42 };
    flattenMenuItems(menu, ctx);
    expect(captured).toEqual(ctx);
  });

  test('mixed static + predicate in same menu', () => {
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'static-disabled', label: 'X', disabled: true },
        { kind: 'command', id: 'static-enabled',  label: 'Y', disabled: false },
        { kind: 'command', id: 'pred',            label: 'Z', disabled: (ctx) => Boolean(ctx.flag) },
      ],
    };
    const flat = flattenMenuItems(menu, { flag: true });
    expect(flat[0]!.disabled).toBe(true);
    expect(flat[1]!.disabled).toBe(false);
    expect(flat[2]!.disabled).toBe(true);
  });

  test('hidden takes precedence over predicate (hidden items skipped before disabled eval)', () => {
    let predicateCalls = 0;
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'hidden-item', label: 'H', hidden: true,
          disabled: () => { predicateCalls++; return true; } },
        { kind: 'command', id: 'visible', label: 'V' },
      ],
    };
    const flat = flattenMenuItems(menu, {});
    expect(flat.map(i => i.value)).toEqual(['visible']);
    expect(predicateCalls).toBe(0);  // skipped before predicate eval
  });
});

describe('CMX-3 · registry.showMenu pipes ctx through to presenter', () => {
  test('ShowMenuOptions.context reaches presenter', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const handle = reg.registerMenu({
      items: [{ kind: 'command', id: 'x', label: 'X' }],
    });
    const resultP = reg.showMenu(handle, { x: 0, y: 0 }, { context: { foo: 'bar' } });
    expect(stub.calls.length).toBe(1);
    expect(stub.calls[0]!.opts?.context).toEqual({ foo: 'bar' });
    stub.resolvers[0]!({ value: 'x', reason: 'selected' });
    await resultP;
  });

  test('showMenu without opts → presenter receives undefined context (backward-compat)', async () => {
    const stub = makeStubPresenter();
    const reg = createContextMenuRegistry({
      nextId: makeSeqId(),
      presenter: stub.presenter,
    });
    const handle = reg.registerMenu({
      items: [{ kind: 'command', id: 'x', label: 'X' }],
    });
    const resultP = reg.showMenu(handle, { x: 0, y: 0 });
    expect(stub.calls[0]!.opts?.context).toBeUndefined();
    stub.resolvers[0]!({ value: 'x', reason: 'selected' });
    await resultP;
  });
});

describe('CMX-3 · predicate survives registry clone cycle', () => {
  test('predicate reference preserved across registerMenu → getMenu', () => {
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    let callCount = 0;
    const pred = (ctx: MenuEvalContext): boolean => {
      callCount++;
      return Boolean(ctx.locked);
    };
    const handle = reg.registerMenu({
      items: [{ kind: 'command', id: 'x', label: 'X', disabled: pred }],
    });
    const got = reg.getMenu(handle);
    expect(got).not.toBeNull();
    const first = got!.items[0]!;
    if (first.kind === 'command' && typeof first.disabled === 'function') {
      // Invoke the cloned predicate — should produce the same result
      // as the original (since cloneMenu preserves fn reference).
      expect(first.disabled({ locked: true })).toBe(true);
      expect(first.disabled({ locked: false })).toBe(false);
      expect(callCount).toBe(2);
    } else {
      throw new Error('expected predicate to survive clone');
    }
  });

  test('registry clone does NOT invoke predicate during clone', () => {
    let callCount = 0;
    const reg = createContextMenuRegistry({ nextId: makeSeqId() });
    reg.registerMenu({
      items: [{ kind: 'command', id: 'x', label: 'X',
        disabled: () => { callCount++; return false; } }],
    });
    // Register completed — clone must not have fired the predicate.
    expect(callCount).toBe(0);
  });
});
