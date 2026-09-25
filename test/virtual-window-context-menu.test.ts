import { describe, expect, test } from 'bun:test';
import {
  createVirtualWindowTitleMenuProvider,
  registerVirtualWindowContextMenus,
} from '../src/virtual-window-context-menu.js';
import { createMenuProviderRegistry } from '../src/ui/context-menu-providers.js';
import type { HitTarget } from '../src/display/types.js';

describe('virtual-window title context menu provider', () => {
  const hit: HitTarget = { kind: 'vw-pane-title', windowId: '7', paneId: 'editor' };

  test('builds a selector menu with payload', () => {
    const menu = createVirtualWindowTitleMenuProvider()(hit, {});
    expect(menu).not.toBeNull();
    expect(menu!.id).toBe('vw-pane-title:7:editor');
    expect(menu!.items).toHaveLength(5);
    expect(menu!.items[0]).toMatchObject({
      kind: 'command',
      id: 'vw.selector',
      payload: { windowId: '7', paneId: 'editor' },
    });
    expect(menu!.items[2]).toMatchObject({
      kind: 'command',
      id: 'vw.clipboard-companion',
      payload: { windowId: '7', paneId: 'editor' },
    });
    expect(menu!.items[3]).toMatchObject({ kind: 'command', id: 'vw.memo-companion' });
    expect(menu!.items[4]).toMatchObject({ kind: 'command', id: 'vw.detail-companion' });
  });

  test('adds return-to-popup for popup-capable pane kinds', () => {
    const menu = createVirtualWindowTitleMenuProvider({
      resolvePaneKind: () => 'terminal-slot',
    })(hit, {});
    expect(menu).not.toBeNull();
    const ids = menu!.items
      .filter((item) => item.kind === 'command')
      .map((item) => (item.kind === 'command' ? item.id : ''));
    expect(ids).toEqual([
      'vw.selector',
      'vw.clipboard-companion',
      'vw.memo-companion',
      'vw.detail-companion',
      'vw.return-popup',
    ]);
  });

  test('registers on wildcard vw-pane-title:* and resolves a specific hit', () => {
    const providers = createMenuProviderRegistry();
    registerVirtualWindowContextMenus(providers, {
      resolvePaneKind: () => 'vw-preview',
      isCompanionOpen: (_payload, key) => key !== 'detail',
    });
    const menu = providers.resolve(hit, {});
    const ids = menu?.items
      .filter((item) => item.kind === 'command')
      .map((item) => (item.kind === 'command' ? item.id : ''));
    expect(ids).toEqual([
      'vw.selector',
      'vw.clipboard-companion',
      'vw.memo-companion',
      'vw.detail-companion',
      'vw.return-popup',
    ]);
    const clipboard = menu?.items.find(
      (item) => item.kind === 'command' && item.id === 'vw.clipboard-companion',
    );
    expect(clipboard).toMatchObject({ kind: 'command', label: 'Hide clipboard companion' });
    const memo = menu?.items.find(
      (item) => item.kind === 'command' && item.id === 'vw.memo-companion',
    );
    expect(memo).toMatchObject({ kind: 'command', label: 'Hide memo companion' });
    const detail = menu?.items.find(
      (item) => item.kind === 'command' && item.id === 'vw.detail-companion',
    );
    expect(detail).toMatchObject({ kind: 'command', label: 'Show detail companion' });
  });
});
