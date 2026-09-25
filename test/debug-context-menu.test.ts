import { describe, expect, test } from 'bun:test';
import {
  createDebugContextMenuProvider,
  registerDebugContextMenus,
} from '../src/debug-context-menu.js';
import { createMenuProviderRegistry } from '../src/ui/context-menu-providers.js';

describe('debug context menu provider', () => {
  test('builds copy-path and submenu entries for debug companion modal hits', () => {
    const provider = createDebugContextMenuProvider({
      getPath: () => '/tmp/debug.log',
      getLevel: () => 'diag',
    });
    const menu = provider({ kind: 'modal-body', modalId: 'companion-widget:debug-events' }, {});
    expect(menu?.title).toBe('Debug Events');
    expect(menu?.items).toHaveLength(2);
    const copy = menu?.items[0];
    expect(copy?.kind).toBe('command');
    if (copy?.kind === 'command') {
      expect(copy.id).toBe('debug.copy-path');
      expect(copy.payload).toEqual({ path: '/tmp/debug.log' });
    }
    const mode = menu?.items[1];
    expect(mode?.kind).toBe('command');
    if (mode?.kind === 'command') {
      expect(mode.submenu?.title).toBe('Debug mode');
      expect(mode.submenu?.items.map(item => item.kind === 'single-choice' ? item.id : item.kind)).toEqual([
        'debug.mode.on',
        'debug.mode.diag',
        'debug.mode.file',
      ]);
      const diag = mode.submenu?.items[1];
      expect(diag?.kind).toBe('single-choice');
      if (diag?.kind === 'single-choice') expect(diag.selected).toBe(true);
    }
  });

  test('registers modal-body and modal-title keys for debug modal families', () => {
    const providers = createMenuProviderRegistry();
    const dispose = registerDebugContextMenus(providers, {
      getPath: () => '/tmp/debug.log',
      getLevel: () => 'trail',
    });
    expect(providers.resolve({ kind: 'modal-body', modalId: 'debug-window' }, {})?.title).toBe('Debug Window');
    expect(providers.resolve({ kind: 'modal-title', modalId: 'companion-widget:debug-events' }, {})?.title).toBe('Debug Events');
    dispose();
    expect(providers.resolve({ kind: 'modal-body', modalId: 'debug-window' }, {})).toBeNull();
  });
});
