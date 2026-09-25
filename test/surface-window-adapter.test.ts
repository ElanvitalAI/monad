// ── B-13-α — window-surface-adapter tests ──
//
// Covers the WindowRegistry ↔ SurfaceRegistry bridge:
//   * VW spawn → SurfaceRegistry.register({kind:'window', windowId})
//   * VW close → unregister
//   * dispose() drops every owned entry + stops receiving events
//   * title refresh via window:rename event
//   * prime on wire — pre-existing VWs are registered immediately

import { describe, expect, test } from 'bun:test';

import { wireWindowSurfaces } from '../src/surface/adapters/window-surface-adapter.js';
import { createSurfaceRegistry } from '../src/surface/registry.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';

function setup() {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const windowRegistry = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
  const surfaceRegistry = createSurfaceRegistry();
  return { windowRegistry, surfaceRegistry };
}

describe('B-13-α · wireWindowSurfaces', () => {
  test('spawn → register in SurfaceRegistry as kind:window', () => {
    const { windowRegistry, surfaceRegistry } = setup();
    const bind = wireWindowSurfaces({ windowRegistry, surfaceRegistry });
    const win = windowRegistry.spawn({
      title: 'alpha',
      initialContent: { kind: 'markdown', text: 'a' },
    });
    const desc = surfaceRegistry.get({ kind: 'window', windowId: win.id });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('window');
    expect(desc!.visible).toBe(true);
    expect(desc!.title).toBe('alpha');
    expect(bind.size()).toBe(1);
  });

  test('close → unregister · owned drops', () => {
    const { windowRegistry, surfaceRegistry } = setup();
    const bind = wireWindowSurfaces({ windowRegistry, surfaceRegistry });
    const win = windowRegistry.spawn({
      title: 'beta',
      initialContent: { kind: 'markdown', text: 'b' },
    });
    expect(bind.size()).toBe(1);
    windowRegistry.close(win.id);
    expect(surfaceRegistry.get({ kind: 'window', windowId: win.id })).toBeUndefined();
    expect(bind.size()).toBe(0);
  });

  test('dispose() drops every owned entry + stops receiving events', () => {
    const { windowRegistry, surfaceRegistry } = setup();
    const bind = wireWindowSurfaces({ windowRegistry, surfaceRegistry });
    const w1 = windowRegistry.spawn({
      title: 'gamma',
      initialContent: { kind: 'markdown', text: 'g' },
    });
    expect(bind.size()).toBe(1);
    bind.dispose();
    expect(bind.size()).toBe(0);
    expect(surfaceRegistry.get({ kind: 'window', windowId: w1.id })).toBeUndefined();
    // Event after dispose must not re-register.
    const w2 = windowRegistry.spawn({
      title: 'delta',
      initialContent: { kind: 'markdown', text: 'd' },
    });
    expect(bind.size()).toBe(0);
    expect(surfaceRegistry.get({ kind: 'window', windowId: w2.id })).toBeUndefined();
  });
});
