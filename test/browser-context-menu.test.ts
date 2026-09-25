// CMX-2 · Browser context menu provider tests.

import { describe, expect, test } from 'bun:test';
import {
  createBrowserBodyMenuProvider,
  createBrowserTitleMenuProvider,
  registerBrowserContextMenus,
  type BrowserBodyMenuPayload,
} from '../src/browser-context-menu.js';
import { createMenuProviderRegistry } from '../src/ui/context-menu-providers.js';
import { createWorkingDirState, type WorkingDirState } from '../src/working-dir/index.js';
import type { HitTarget } from '../src/display/types.js';

function wdWithEntry(entry: Partial<WorkingDirState['entries'][number]> & { name: string }): WorkingDirState {
  const state = createWorkingDirState('/tmp');
  state.entries = [{
    name: entry.name,
    absPath: entry.absPath ?? `/tmp/${entry.name}`,
    isDir: entry.isDir ?? false,
    ...(entry as object),
  }] as WorkingDirState['entries'];
  state.cursor = 0;
  return state;
}

// QA fix (2026-04-22) — production paneId is 'wd-browser'
// (dashboard.ts:5300 widgetHost spawn id · propagated by
// getPaneHitTarget as widgetInstanceId → paneId). Fixtures aligned
// with production; registerBrowserContextMenus default matches.
const paneBodyHit: HitTarget = { kind: 'pane-body', paneId: 'wd-browser' };
const paneTitleHit: HitTarget = { kind: 'pane-title', paneId: 'wd-browser' };

describe('CMX-2 · createBrowserBodyMenuProvider', () => {
  test('file cursor entry → Attach/Copy/Open/Reveal items', () => {
    const state = wdWithEntry({ name: 'x.ts', isDir: false });
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    const menu = provider(paneBodyHit, {});
    expect(menu).not.toBeNull();
    const ids = menu!.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i.kind === 'command' ? i.id : ''));
    expect(ids).toEqual(['browser.attach', 'browser.copy-path', 'browser.open', 'browser.reveal']);
  });

  test('file items carry payload with absPath + isDir + name', () => {
    const state = wdWithEntry({ name: 'x.ts', isDir: false });
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    const menu = provider(paneBodyHit, {})!;
    const attach = menu.items.find(
      (i) => i.kind === 'command' && i.id === 'browser.attach',
    );
    expect(attach).toBeDefined();
    if (attach?.kind === 'command') {
      const p = attach.payload as BrowserBodyMenuPayload;
      expect(p.absPath).toBe('/tmp/x.ts');
      expect(p.isDir).toBe(false);
      expect(p.name).toBe('x.ts');
      expect(p.browserId).toBe('wd-browser');
    }
  });

  test('directory cursor entry → Attach is supported and relabeled', () => {
    const state = wdWithEntry({ name: 'subdir', isDir: true });
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    const menu = provider(paneBodyHit, {})!;
    const attach = menu.items.find(
      (i) => i.kind === 'command' && i.id === 'browser.attach',
    );
    expect(attach).toBeDefined();
    if (attach?.kind === 'command') {
      expect(attach.disabled).toBeFalsy();
      expect(attach.label).toBe('Attach from directory');
    }
  });

  test('pane-body hit refinement itemIndex overrides keyboard cursor', () => {
    const state = createWorkingDirState('/tmp');
    state.entries = [
      { name: 'src', absPath: '/tmp/src', isDir: true } as any,
      { name: 'README.md', absPath: '/tmp/README.md', isDir: false } as any,
    ];
    state.cursor = 0;
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    const menu = provider({
      kind: 'pane-body',
      paneId: 'wd-browser',
      hit: { kind: 'list-row', itemIndex: 1 },
    }, {})!;
    expect(menu.title).toBe('README.md');
  });

  test('directory cursor entry → Open relabeled to "Enter directory"', () => {
    const state = wdWithEntry({ name: 'subdir', isDir: true });
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    const menu = provider(paneBodyHit, {})!;
    const open = menu.items.find(
      (i) => i.kind === 'command' && i.id === 'browser.open',
    );
    expect(open?.kind === 'command' && open.label).toBe('Enter directory');
  });

  test('".." entry → null (no actionable menu)', () => {
    const state = wdWithEntry({ name: '..', absPath: '/', isDir: true });
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    expect(provider(paneBodyHit, {})).toBeNull();
  });

  test('empty listing → null', () => {
    const state = createWorkingDirState('/tmp');
    state.entries = [];
    const provider = createBrowserBodyMenuProvider({ workingDirState: state });
    expect(provider(paneBodyHit, {})).toBeNull();
  });

  test('menu title mirrors cursor entry name (with / suffix for dir)', () => {
    const fileState = wdWithEntry({ name: 'x.ts', isDir: false });
    const dirState = wdWithEntry({ name: 'src', isDir: true });
    const fileMenu = createBrowserBodyMenuProvider({ workingDirState: fileState })(paneBodyHit, {});
    const dirMenu = createBrowserBodyMenuProvider({ workingDirState: dirState })(paneBodyHit, {});
    expect(fileMenu?.title).toBe('x.ts');
    expect(dirMenu?.title).toBe('src/');
  });

  test('menu id namespace is stable per absPath', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const menu = createBrowserBodyMenuProvider({ workingDirState: state })(paneBodyHit, {})!;
    expect(menu.id).toBe('pane-body:/tmp/x.ts');
  });
});

describe('CMX-2 · createBrowserTitleMenuProvider', () => {
  test('onSplit not provided → null (nothing to offer)', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const provider = createBrowserTitleMenuProvider({ workingDirState: state });
    expect(provider(paneTitleHit, {})).toBeNull();
  });

  test('onSplit provided → Split items only (close/rename/detach off)', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const provider = createBrowserTitleMenuProvider({
      workingDirState: state,
      onSplit: () => {},
    });
    const menu = provider(paneTitleHit, {})!;
    expect(menu).not.toBeNull();
    const ids = menu.items
      .filter((i) => i.kind === 'command')
      .map((i) => (i.kind === 'command' ? i.id : ''));
    expect(ids).toContain('pane.split.h');
    expect(ids).toContain('pane.split.v');
    expect(ids).not.toContain('pane.close');
    expect(ids).not.toContain('pane.rename');
    expect(ids).not.toContain('pane.detach');
  });
});

describe('CMX-2 · registerBrowserContextMenus', () => {
  test('registers body + title providers', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const providers = createMenuProviderRegistry();
    registerBrowserContextMenus(providers, {
      workingDirState: state,
      onSplit: () => {},
    });
    expect(providers.resolve(paneBodyHit)).not.toBeNull();
    expect(providers.resolve(paneTitleHit)).not.toBeNull();
  });

  test('dispose removes both providers', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const providers = createMenuProviderRegistry();
    const dispose = registerBrowserContextMenus(providers, {
      workingDirState: state,
      onSplit: () => {},
    });
    dispose();
    expect(providers.resolve(paneBodyHit)).toBeNull();
    expect(providers.resolve(paneTitleHit)).toBeNull();
  });

  test('dispose idempotent', () => {
    const state = wdWithEntry({ name: 'x.ts' });
    const providers = createMenuProviderRegistry();
    const dispose = registerBrowserContextMenus(providers, {
      workingDirState: state,
    });
    dispose();
    dispose();  // no throw
    expect(providers.resolve(paneBodyHit)).toBeNull();
  });
});
