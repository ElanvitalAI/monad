// ── IUL Phase S·a — pane-surface adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  registerPaneSurface,
  unregisterPaneSurface,
  importFactorySnapshot,
  createSurfaceRegistry,
} from '../src/surface/index.js';
import { PaneFactory } from '../src/panes/factory.js';
import { PlaceholderPane } from '../src/panes/placeholder-pane.js';

describe('pane-surface adapter', () => {
  test('registerPaneSurface inserts a registry entry derived from pane', () => {
    const reg = createSurfaceRegistry();
    const pane = new PlaceholderPane({ windowId: 'w1', paneId: 'p1' }, 'empty');
    registerPaneSurface(reg, pane);
    const desc = reg.get({ kind: 'pane', ref: { windowId: 'w1', paneId: 'p1' } });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('placeholder');
    expect(desc!.tier).toBe('vw');
    expect(desc!.visible).toBe(true);
    expect(typeof desc!.title).toBe('string');
  });

  test('unregisterPaneSurface removes the entry; missing returns false', () => {
    const reg = createSurfaceRegistry();
    const pane = new PlaceholderPane({ windowId: 'w', paneId: 'p' }, 'empty');
    registerPaneSurface(reg, pane);
    expect(unregisterPaneSurface(reg, pane.ref)).toBe(true);
    expect(unregisterPaneSurface(reg, pane.ref)).toBe(false);
  });

  test('importFactorySnapshot registers each cached pane in the factory', () => {
    const factory = new PaneFactory();
    const reg = createSurfaceRegistry();
    factory.resolvePlaceholder({ windowId: 'w', paneId: 'p1' }, 'empty');
    factory.resolvePlaceholder({ windowId: 'w', paneId: 'p2' }, 'loading');
    const count = importFactorySnapshot({
      factory, registry: reg,
      refs: [{ windowId: 'w', paneId: 'p1' }, { windowId: 'w', paneId: 'p2' }],
    });
    expect(count).toBe(2);
    expect(reg.list().length).toBe(2);
    expect(reg.listByKind('pane').length).toBe(2);
  });

  test('importFactorySnapshot skips uncached refs without throwing', () => {
    const factory = new PaneFactory();
    const reg = createSurfaceRegistry();
    factory.resolvePlaceholder({ windowId: 'w', paneId: 'present' }, 'empty');
    const count = importFactorySnapshot({
      factory, registry: reg,
      refs: [
        { windowId: 'w', paneId: 'present' },
        { windowId: 'w', paneId: 'missing' },
      ],
    });
    expect(count).toBe(1);
  });
});
