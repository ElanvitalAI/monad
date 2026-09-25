import { describe, expect, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import { createContextMenuRegistry, type Menu } from '../src/ui/context-menu-registry.js';
import { createDefaultMenuPresenter } from '../src/ui/context-menu-presenter.js';

function openMenu(registry: ReturnType<typeof createContextMenuRegistry>, handle: string, pos: { x: number; y: number }) {
  return registry.showMenu(handle as never, pos, { singleInstance: true });
}

describe('R7 step 2 · explicit single-instance menu policy', () => {
  test('opening a second single-instance context menu replaces the first instead of stacking', () => {
    const coordinator = new DisplayCoordinator({ frameMs: 0 });
    const presenter = createDefaultMenuPresenter({
      termSize: () => ({ rows: 24, cols: 80 }),
      pushSurface: surface => coordinator.pushModal(surface),
    });
    const registry = createContextMenuRegistry({ presenter });
    const menu: Menu = {
      items: [
        { kind: 'command', id: 'open', label: 'Open' },
        { kind: 'command', id: 'copy', label: 'Copy' },
      ],
    };
    const first = registry.registerMenu(menu);
    const second = registry.registerMenu(menu);

    void openMenu(registry, first, { x: 10, y: 5 });
    let live = coordinator.modalLifecycleAPI().stackOrder().filter(h => !h.isDisposed());
    expect(live).toHaveLength(1);
    expect(live[0]!.typeName).toBe('__coord-mirror:menu');
    expect(live[0]!.surface.id).toBe('context-menu');
    const firstBounds = { ...live[0]!.surface.bounds };

    void openMenu(registry, second, { x: 30, y: 12 });
    live = coordinator.modalLifecycleAPI().stackOrder().filter(h => !h.isDisposed());
    expect(live).toHaveLength(1);
    expect(live[0]!.typeName).toBe('__coord-mirror:menu');
    expect(live[0]!.surface.id).toBe('context-menu');
    expect(live[0]!.surface.bounds.row).toBeGreaterThan(firstBounds.row);
    expect(live[0]!.surface.bounds.col).toBeGreaterThan(firstBounds.col);
  });

  test('menus without singleInstance keep unique surface ids', () => {
    const coordinator = new DisplayCoordinator({ frameMs: 0 });
    const presenter = createDefaultMenuPresenter({
      termSize: () => ({ rows: 24, cols: 80 }),
      pushSurface: surface => coordinator.pushModal(surface),
    });
    const registry = createContextMenuRegistry({ presenter });
    const menu: Menu = {
      items: [{ kind: 'command', id: 'open', label: 'Open' }],
    };
    const handle = registry.registerMenu(menu);
    void registry.showMenu(handle, { x: 10, y: 5 });
    const live = coordinator.modalLifecycleAPI().stackOrder().filter(h => !h.isDisposed());
    expect(live).toHaveLength(1);
    expect(live[0]!.surface.id).toBe('context-menu:6:11');
  });
});
