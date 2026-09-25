import type { ProductCompactMode } from '../views/product-compact-mode.js';
import type { PaneFocus } from '../workspace-types.js';
import {
  dispatchDashboardSurfaceCatalogAction,
  type DashboardCompanionSurfaceKey,
} from './compact-surface-dispatch.js';
import {
  buildDashboardSurfaceCatalogTargets,
  type ClosedStarterPaneEntry,
  type DashboardSurfaceCatalogTarget,
} from './compact-surface-inventory.js';

export interface CreateCompactSurfaceRuntimeDeps {
  getClosedPanes: () => ClosedStarterPaneEntry[];
  getActiveViewLabel: () => string;
  getCompactMode: () => ProductCompactMode;
  openDashboardPane: (pane: PaneFocus) => boolean;
  focusPane: (pane: PaneFocus) => void;
  openBrowserPreviewModal: () => void;
  openDashboardPaneModal: (pane: PaneFocus) => void;
  openCompanionPopup: (key: DashboardCompanionSurfaceKey) => void;
  spawnBrowserVirtualWindow: () => void;
  spawnPreviewVirtualWindow: () => void;
  spawnBrowserPreviewVirtualWindow: () => void;
  spawnScratchVirtualWindow: () => void;
  spawnSimVirtualWindow: () => void;
  currentVirtualWindowId: () => number | null;
  openVwCompanion: (windowId: number, key: DashboardCompanionSurfaceKey) => void;
  onWarning?: (message: string) => void;
}

export interface CompactSurfaceRuntime {
  buildTargets: () => DashboardSurfaceCatalogTarget[];
  openTarget: (surfaceId: string) => void;
}

export function createCompactSurfaceRuntime(
  deps: CreateCompactSurfaceRuntimeDeps,
): CompactSurfaceRuntime {
  return {
    buildTargets: () =>
      buildDashboardSurfaceCatalogTargets({
        closedPanes: deps.getClosedPanes(),
        activeViewLabel: deps.getActiveViewLabel(),
        compactMode: deps.getCompactMode(),
      }),
    openTarget: (surfaceId) => {
      dispatchDashboardSurfaceCatalogAction(surfaceId, {
        openDashboardPane: deps.openDashboardPane,
        focusPane: deps.focusPane,
        openBrowserPreviewModal: deps.openBrowserPreviewModal,
        openDashboardPaneModal: deps.openDashboardPaneModal,
        openCompanionPopup: deps.openCompanionPopup,
        spawnBrowserVirtualWindow: deps.spawnBrowserVirtualWindow,
        spawnPreviewVirtualWindow: deps.spawnPreviewVirtualWindow,
        spawnBrowserPreviewVirtualWindow: deps.spawnBrowserPreviewVirtualWindow,
        spawnScratchVirtualWindow: deps.spawnScratchVirtualWindow,
        spawnSimVirtualWindow: deps.spawnSimVirtualWindow,
        currentVirtualWindowId: deps.currentVirtualWindowId,
        openVwCompanion: deps.openVwCompanion,
        onWarning: deps.onWarning,
      });
    },
  };
}
