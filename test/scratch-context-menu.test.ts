// CMX-5.1 · Scratch pane context menu provider tests.

import { describe, expect, test } from 'bun:test';
import {
  createScratchBodyMenuProvider,
  registerScratchContextMenus,
  isScratchEmpty,
  type ScratchMenuPayload,
} from '../src/scratch-context-menu.js';
import { createMenuProviderRegistry } from '../src/ui/context-menu-providers.js';
import { flattenMenuItems } from '../src/ui/context-menu-presenter.js';
import type { HitTarget } from '../src/display/types.js';

const scratchHit: HitTarget = { kind: 'pane-body', paneId: 'wd-scratch' };

describe('CMX-5.1 · isScratchEmpty predicate', () => {
  test('empty scratch (count=0) → disabled=true', () => {
    expect(isScratchEmpty({ scratchLineCount: 0 })).toBe(true);
  });

  test('non-empty scratch (count>0) → disabled=false', () => {
    expect(isScratchEmpty({ scratchLineCount: 5 })).toBe(false);
    expect(isScratchEmpty({ scratchLineCount: 1 })).toBe(false);
  });

  test('missing ctx key → fail-safe disabled=true', () => {
    expect(isScratchEmpty({})).toBe(true);
    expect(isScratchEmpty({ other: 'stuff' })).toBe(true);
  });

  test('non-number ctx value → fail-safe disabled=true', () => {
    expect(isScratchEmpty({ scratchLineCount: 'abc' as never })).toBe(true);
    expect(isScratchEmpty({ scratchLineCount: null as never })).toBe(true);
  });
});

describe('CMX-5.1 · createScratchBodyMenuProvider shape', () => {
  test('returns menu with 3 commands + 1 separator', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 2 });
    const menu = provider(scratchHit, {});
    expect(menu).not.toBeNull();
    expect(menu!.items.length).toBe(4);
    const kinds = menu!.items.map(i => i.kind);
    expect(kinds).toEqual(['command', 'command', 'separator', 'command']);
  });

  test('menu ids match naming convention', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 0 });
    const menu = provider(scratchHit, {})!;
    const ids = menu.items
      .filter(i => i.kind === 'command')
      .map(i => (i.kind === 'command' ? i.id : ''));
    expect(ids).toEqual(['scratch.clear', 'scratch.copy-all', 'scratch.export']);
  });

  test('menu title is "Scratch"', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 3 });
    const menu = provider(scratchHit, {})!;
    expect(menu.title).toBe('Scratch');
  });

  test('menu id namespace is stable', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 0 });
    const menu = provider(scratchHit, {})!;
    expect(menu.id).toBe('pane-body:wd-scratch');
  });
});

describe('CMX-5.1 · label + payload contents', () => {
  test('clear label includes line count when non-empty', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 7 });
    const menu = provider(scratchHit, {})!;
    const clear = menu.items[0];
    expect(clear?.kind).toBe('command');
    if (clear?.kind === 'command') {
      expect(clear.label).toContain('7 lines');
    }
  });

  test('clear label omits count when empty', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 0 });
    const menu = provider(scratchHit, {})!;
    const clear = menu.items[0];
    if (clear?.kind === 'command') {
      expect(clear.label).toBe('Clear scratch');
    }
  });

  test('payload captures lineCount + totalBytes from deps', () => {
    const provider = createScratchBodyMenuProvider({
      getLineCount: () => 5,
      getTotalBytes: () => 128,
    });
    const menu = provider(scratchHit, {})!;
    const clear = menu.items[0];
    if (clear?.kind === 'command') {
      const p = clear.payload as ScratchMenuPayload;
      expect(p.lineCount).toBe(5);
      expect(p.totalBytes).toBe(128);
    }
  });

  test('payload defaults totalBytes to 0 when getTotalBytes omitted', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 3 });
    const menu = provider(scratchHit, {})!;
    const clear = menu.items[0];
    if (clear?.kind === 'command') {
      const p = clear.payload as ScratchMenuPayload;
      expect(p.totalBytes).toBe(0);
      expect(p.lineCount).toBe(3);
    }
  });
});

describe('CMX-5.1 · predicate interaction with flattenMenuItems', () => {
  test('empty scratch ctx → clear + copy disabled · export enabled', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 0 });
    const menu = provider(scratchHit, {})!;
    const flat = flattenMenuItems(menu, { scratchLineCount: 0 });
    // flat skips separator
    expect(flat.length).toBe(3);
    const [clear, copy, exp] = flat;
    expect(clear!.disabled).toBe(true);
    expect(copy!.disabled).toBe(true);
    expect(exp!.disabled).toBe(false);
  });

  test('non-empty scratch ctx → all enabled', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 5 });
    const menu = provider(scratchHit, {})!;
    const flat = flattenMenuItems(menu, { scratchLineCount: 5 });
    expect(flat.every(i => !i.disabled)).toBe(true);
  });

  test('missing scratchLineCount in ctx → predicate fail-safe disables clear+copy', () => {
    const provider = createScratchBodyMenuProvider({ getLineCount: () => 5 });
    const menu = provider(scratchHit, {})!;
    const flat = flattenMenuItems(menu, {});
    expect(flat[0]!.disabled).toBe(true);   // clear
    expect(flat[1]!.disabled).toBe(true);   // copy
    expect(flat[2]!.disabled).toBe(false);  // export
  });
});

describe('CMX-5.1 · registerScratchContextMenus lifecycle', () => {
  test('register + resolve hits scratch provider', () => {
    const providers = createMenuProviderRegistry();
    registerScratchContextMenus(providers, { getLineCount: () => 1 });
    const menu = providers.resolve(scratchHit);
    expect(menu).not.toBeNull();
    expect(menu!.id).toBe('pane-body:wd-scratch');
  });

  test('dispose removes provider', () => {
    const providers = createMenuProviderRegistry();
    const dispose = registerScratchContextMenus(providers, { getLineCount: () => 0 });
    dispose();
    expect(providers.resolve(scratchHit)).toBeNull();
  });

  test('dispose idempotent (double-dispose no-op)', () => {
    const providers = createMenuProviderRegistry();
    const dispose = registerScratchContextMenus(providers, { getLineCount: () => 0 });
    dispose();
    dispose();  // no throw
    expect(providers.resolve(scratchHit)).toBeNull();
  });

  test('unrelated hit kinds → null resolve', () => {
    const providers = createMenuProviderRegistry();
    registerScratchContextMenus(providers, { getLineCount: () => 5 });
    expect(providers.resolve({ kind: 'pane-body', paneId: 'browser' })).toBeNull();
    expect(providers.resolve({ kind: 'pane-title', paneId: 'wd-scratch' })).toBeNull();
  });
});
