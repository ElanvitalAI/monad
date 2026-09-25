import { describe, expect, mock, test } from 'bun:test';

import { createMouseDockRuntime } from '../src/dashboard/input/mouse-dock-runtime.js';
import type { CompactSurfaceHost } from '../src/dashboard/compact-surface-host.js';

function compactSurfaceHostStub(): CompactSurfaceHost {
  return {
    getDockMenuSurfaceTargets: () => [
      { id: 'pane:browser', label: 'Browser', description: 'Open browser', group: 'Panes' },
    ],
    openDockSurface: mock((_surfaceId: string) => {}),
    toggleChatOnly: mock(() => {}),
    getDashboardViews: () => [
      { id: '1', label: 'Default', description: 'Starter: Browser + Preview', active: true },
    ],
    applyDashboardView: mock((_viewId: string) => {}),
  };
}

describe('createMouseDockRuntime', () => {
  test('builds dock window targets from pane list + labels', () => {
    const runtime = createMouseDockRuntime({
      listDockWindowPanes: () => ['browser', 'preview'],
      paneLabel: (pane) => pane === 'browser' ? 'Browser' : 'Preview',
      openDockWindow: () => {},
      compactSurfaceHost: compactSurfaceHostStub(),
      listVirtualWindows: () => [],
      getCurrentVirtualWindowId: () => null,
      switchToVirtualWindow: () => {},
      focusDashboardMain: () => {},
      redraw: () => {},
    });

    expect(runtime.getDockMenuWindowTargets()).toEqual([
      { id: 'browser', label: 'Browser', description: 'Open Browser in a popup window' },
      { id: 'preview', label: 'Preview', description: 'Open Preview in a popup window' },
    ]);
  });

  test('delegates dock surface and dashboard view actions through compact host', async () => {
    const host = compactSurfaceHostStub();
    const redraw = mock(() => {});
    const runtime = createMouseDockRuntime({
      listDockWindowPanes: () => [],
      paneLabel: () => 'ignored',
      openDockWindow: () => {},
      compactSurfaceHost: host,
      listVirtualWindows: () => [],
      getCurrentVirtualWindowId: () => null,
      switchToVirtualWindow: () => {},
      focusDashboardMain: () => {},
      redraw,
    });

    await runtime.onOpenDockSurface('pane:browser');
    await runtime.onApplyDashboardView('1');
    await runtime.onToggleChatOnly();

    expect(host.openDockSurface).toHaveBeenCalledWith('pane:browser');
    expect(host.applyDashboardView).toHaveBeenCalledWith('1');
    expect(host.toggleChatOnly).toHaveBeenCalled();
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  test('builds and switches virtual window entries through registry callbacks', async () => {
    const switchToVirtualWindow = mock((_windowId: number) => {});
    const redraw = mock(() => {});
    const runtime = createMouseDockRuntime({
      listDockWindowPanes: () => [],
      paneLabel: () => 'ignored',
      openDockWindow: () => {},
      compactSurfaceHost: compactSurfaceHostStub(),
      listVirtualWindows: () => [
        { id: 3, title: 'Three' },
        { id: 1, title: 'One' },
      ],
      getCurrentVirtualWindowId: () => 3,
      switchToVirtualWindow,
      focusDashboardMain: () => {},
      redraw,
    });

    expect(runtime.getVirtualWindows()).toEqual([
      { id: 1, label: 'One', active: false },
      { id: 3, label: 'Three', active: true },
    ]);

    await runtime.onSwitchVirtualWindow(1);
    expect(switchToVirtualWindow).toHaveBeenCalledTimes(1);
    expect(switchToVirtualWindow).toHaveBeenCalledWith(1);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  test('builds mover state and routes left/right relative to main and sorted windows', async () => {
    const switchToVirtualWindow = mock((_windowId: number) => {});
    const focusDashboardMain = mock(() => {});
    const redraw = mock(() => {});
    let currentWindowId: number | null = null;
    const runtime = createMouseDockRuntime({
      listDockWindowPanes: () => [],
      paneLabel: () => 'ignored',
      openDockWindow: () => {},
      compactSurfaceHost: compactSurfaceHostStub(),
      listVirtualWindows: () => [
        { id: 2, title: 'Build' },
        { id: 1, title: 'ACP' },
      ],
      getCurrentVirtualWindowId: () => currentWindowId,
      switchToVirtualWindow,
      focusDashboardMain,
      redraw,
    });

    expect(runtime.getVirtualWindowMover()).toEqual({
      canMoveLeft: false,
      canMoveRight: true,
      leftLabel: '⏹️',
      rightLabel: 'ACP ➡️',
    });

    await runtime.onMoveVirtualWindow('right');
    expect(switchToVirtualWindow).toHaveBeenCalledWith(1);

    currentWindowId = 1;
    expect(runtime.getVirtualWindowMover()).toEqual({
      canMoveLeft: true,
      canMoveRight: true,
      leftLabel: '⬅️ Main',
      rightLabel: 'Build ➡️',
    });

    await runtime.onMoveVirtualWindow('left');
    expect(focusDashboardMain).toHaveBeenCalled();

    currentWindowId = 2;
    expect(runtime.getVirtualWindowMover()).toEqual({
      canMoveLeft: true,
      canMoveRight: false,
      leftLabel: '⬅️ ACP',
      rightLabel: '⏹️',
    });
  });

  test('trims mover target labels to 5 glyphs plus ellipsis', () => {
    const runtime = createMouseDockRuntime({
      listDockWindowPanes: () => [],
      paneLabel: () => 'ignored',
      openDockWindow: () => {},
      compactSurfaceHost: compactSurfaceHostStub(),
      listVirtualWindows: () => [
        { id: 1, title: 'WorkspaceLong' },
        { id: 2, title: 'SimulatorLong' },
      ],
      getCurrentVirtualWindowId: () => 1,
      switchToVirtualWindow: () => {},
      focusDashboardMain: () => {},
      redraw: () => {},
    });

    expect(runtime.getVirtualWindowMover()).toEqual({
      canMoveLeft: true,
      canMoveRight: true,
      leftLabel: '⬅️ Main',
      rightLabel: 'Simul… ➡️',
    });
  });
});
