import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function read(rel: string): string {
  return readFileSync(resolve(import.meta.dir, '..', rel), 'utf8');
}

describe('ui foundation · R6 interaction bridge source truth', () => {
  test('dashboard virtual windows exposes separate selector and context-menu callbacks', () => {
    // 2026-07-07 · dashboard decomposition: src/dashboard-virtual-windows.ts
    // moved to src/dashboard/windowing/virtual-windows.ts.
    const src = read('src/dashboard/windowing/virtual-windows.ts');
    expect(src).toContain('onShowSelector?:');
    expect(src).toContain('onShowContextMenu?:');
  });

  test('dashboard routes vw pane-title right click through ctxMenuWire with vw-pane-title hitTarget', () => {
    // 2026-07-07 · dashboard decomposition: the onShowContextMenu
    // callback + vw-pane-title hitTarget moved to
    // src/dashboard/virtual-window-input-runtime.ts, the
    // registerVirtualWindowContextMenus registration moved to
    // src/dashboard/context-menu-provider-boot.ts (arg renamed
    // ctxMenuProviders → providers inside the boot module), and
    // dashboard/index.ts keeps the ctxMenuWire routing seam
    // (routeContextMenu → ctxMenuWire.onMouse) + boots the provider
    // registry. Same invariant, asserted across the three files.
    const vwInputRuntime = read('src/dashboard/virtual-window-input-runtime.ts');
    expect(vwInputRuntime).toContain('onShowContextMenu: (windowId, paneId, col, row) => {');
    expect(vwInputRuntime).toContain("hitTarget: { kind: 'vw-pane-title'");

    const ctxMenuBoot = read('src/dashboard/context-menu-provider-boot.ts');
    expect(ctxMenuBoot).toContain('registerVirtualWindowContextMenus(providers, {');

    const dashboard = read('src/dashboard/index.ts');
    expect(dashboard).toContain('const ctxMenuProviders = bootDashboardContextMenuProviders({');
    expect(dashboard).toContain('routeContextMenu: (req) => ctxMenuWire.onMouse(req)');
  });
});
