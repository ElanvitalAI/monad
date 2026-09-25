import {
  buildDashboardDockWindowTargets,
  buildDashboardVirtualWindowEntries,
  type DashboardVirtualWindowSeed,
} from '../dock-picker-inventory.js';
import type { CompactSurfaceHost } from '../compact-surface-host.js';
import type { PaneFocus } from '../../workspace-types.js';

export interface MouseDockRuntimeDeps {
  listDockWindowPanes: () => PaneFocus[];
  paneLabel: (pane: PaneFocus) => string;
  openDockWindow: (pane: PaneFocus) => void;
  compactSurfaceHost: CompactSurfaceHost;
  listVirtualWindows: () => DashboardVirtualWindowSeed[];
  getCurrentVirtualWindowId: () => number | null;
  switchToVirtualWindow: (windowId: number) => void;
  focusDashboardMain: () => void;
  redraw: () => void;
}

export interface DashboardVirtualWindowMoverState {
  canMoveLeft: boolean;
  canMoveRight: boolean;
  leftLabel: string;
  rightLabel: string;
}

export interface MouseDockRuntime {
  getDockMenuWindowTargets: () => ReturnType<typeof buildDashboardDockWindowTargets>;
  onOpenDockWindow: (paneId: string) => Promise<void>;
  getDockMenuSurfaceTargets: () => ReturnType<CompactSurfaceHost['getDockMenuSurfaceTargets']>;
  onOpenDockSurface: (surfaceId: string) => Promise<void>;
  onToggleChatOnly: () => Promise<void>;
  getDashboardViews: () => ReturnType<CompactSurfaceHost['getDashboardViews']>;
  onApplyDashboardView: (viewId: string) => Promise<void>;
  getVirtualWindows: () => ReturnType<typeof buildDashboardVirtualWindowEntries>;
  onSwitchVirtualWindow: (windowId: number) => Promise<void>;
  getVirtualWindowMover: () => DashboardVirtualWindowMoverState;
  onMoveVirtualWindow: (direction: 'left' | 'right') => Promise<boolean>;
}

export function createMouseDockRuntime(
  deps: MouseDockRuntimeDeps,
): MouseDockRuntime {
  const sortedWindows = (): DashboardVirtualWindowSeed[] =>
    deps.listVirtualWindows().slice().sort((a, b) => a.id - b.id);
  const windowLabel = (window: DashboardVirtualWindowSeed): string =>
    window.title.trim() ? window.title : `VW#${window.id}`;
  const moverTargetLabel = (window: DashboardVirtualWindowSeed): string => {
    const label = windowLabel(window);
    return label.length > 5 ? `${label.slice(0, 5)}…` : label;
  };

  const switchVirtualWindowThroughRegistry = (windowId: number): void => {
    deps.switchToVirtualWindow(windowId);
    deps.redraw();
  };

  const moverState = (): DashboardVirtualWindowMoverState => {
    const windows = sortedWindows();
    const current = deps.getCurrentVirtualWindowId();
    if (windows.length === 0) {
      return {
        canMoveLeft: false,
        canMoveRight: false,
        leftLabel: '⏹️',
        rightLabel: '⏹️',
      };
    }
    if (current === null) {
      return {
        canMoveLeft: false,
        canMoveRight: true,
        leftLabel: '⏹️',
        rightLabel: `${moverTargetLabel(windows[0]!)} ➡️`,
      };
    }
    const idx = windows.findIndex((window) => window.id === current);
    if (idx < 0) {
      return {
        canMoveLeft: false,
        canMoveRight: true,
        leftLabel: '⏹️',
        rightLabel: `${moverTargetLabel(windows[0]!)} ➡️`,
      };
    }
    return {
      canMoveLeft: true,
      canMoveRight: idx < windows.length - 1,
      leftLabel: idx === 0 ? '⬅️ Main' : `⬅️ ${moverTargetLabel(windows[idx - 1]!)}`,
      rightLabel: idx < windows.length - 1 ? `${moverTargetLabel(windows[idx + 1]!)} ➡️` : '⏹️',
    };
  };

  return {
    getDockMenuWindowTargets: () =>
      buildDashboardDockWindowTargets(
        deps.listDockWindowPanes().map((pane) => ({
          pane,
          label: deps.paneLabel(pane),
        })),
      ),
    onOpenDockWindow: async (paneId) => {
      deps.openDockWindow(paneId as PaneFocus);
      deps.redraw();
    },
    getDockMenuSurfaceTargets: () => deps.compactSurfaceHost.getDockMenuSurfaceTargets(),
    onOpenDockSurface: async (surfaceId) => {
      deps.compactSurfaceHost.openDockSurface(surfaceId);
      deps.redraw();
    },
    onToggleChatOnly: async () => {
      deps.compactSurfaceHost.toggleChatOnly();
    },
    getDashboardViews: () => deps.compactSurfaceHost.getDashboardViews(),
    onApplyDashboardView: async (viewId) => {
      deps.compactSurfaceHost.applyDashboardView(viewId);
      deps.redraw();
    },
    getVirtualWindows: () =>
      buildDashboardVirtualWindowEntries(
        deps.listVirtualWindows(),
        deps.getCurrentVirtualWindowId(),
      ),
    onSwitchVirtualWindow: async (windowId) => {
      switchVirtualWindowThroughRegistry(windowId);
    },
    getVirtualWindowMover: () => moverState(),
    onMoveVirtualWindow: async (direction) => {
      const windows = sortedWindows();
      const current = deps.getCurrentVirtualWindowId();
      if (windows.length === 0) return false;
      if (direction === 'right') {
        if (current === null) {
          deps.switchToVirtualWindow(windows[0]!.id);
          return true;
        }
        const idx = windows.findIndex((window) => window.id === current);
        if (idx >= 0 && idx < windows.length - 1) {
          deps.switchToVirtualWindow(windows[idx + 1]!.id);
          return true;
        }
        return false;
      }
      if (current === null) return false;
      const idx = windows.findIndex((window) => window.id === current);
      if (idx < 0) return false;
      if (idx === 0) {
        deps.focusDashboardMain();
        return true;
      }
      deps.switchToVirtualWindow(windows[idx - 1]!.id);
      return true;
    },
  };
}
