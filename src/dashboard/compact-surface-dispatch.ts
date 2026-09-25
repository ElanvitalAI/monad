import type { PaneFocus } from '../workspace-types.js';

export type DashboardCompanionSurfaceKey = 'clipboard' | 'memo' | 'detail';

export interface DispatchDashboardSurfaceCatalogActionDeps {
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

export function dispatchDashboardSurfaceCatalogAction(
  surfaceId: string,
  deps: DispatchDashboardSurfaceCatalogActionDeps,
): void {
  if (surfaceId.startsWith('reopen:')) {
    const pane = surfaceId.slice('reopen:'.length) as PaneFocus;
    if (deps.openDashboardPane(pane)) {
      deps.focusPane(pane);
    } else {
      deps.onWarning?.(`could not reopen pane: ${surfaceId.slice('reopen:'.length)}`);
    }
    return;
  }
  if (surfaceId === 'pane:browser-preview') {
    deps.openBrowserPreviewModal();
    return;
  }
  if (surfaceId.startsWith('pane:')) {
    deps.openDashboardPaneModal(surfaceId.slice('pane:'.length) as PaneFocus);
    return;
  }
  if (surfaceId.startsWith('companion:')) {
    const key = surfaceId.slice('companion:'.length);
    if (key === 'clipboard' || key === 'memo' || key === 'detail') {
      deps.openCompanionPopup(key);
    }
    return;
  }
  if (surfaceId === 'vw:browser') {
    deps.spawnBrowserVirtualWindow();
    return;
  }
  if (surfaceId === 'vw:preview') {
    deps.spawnPreviewVirtualWindow();
    return;
  }
  if (surfaceId === 'vw:browser-preview') {
    deps.spawnBrowserPreviewVirtualWindow();
    return;
  }
  if (surfaceId === 'vw:scratch') {
    deps.spawnScratchVirtualWindow();
    return;
  }
  if (surfaceId === 'vw:sim') {
    deps.spawnSimVirtualWindow();
    return;
  }
  if (surfaceId.startsWith('vw-companion:')) {
    const key = surfaceId.slice('vw-companion:'.length);
    const windowId = deps.currentVirtualWindowId();
    if (!Number.isInteger(windowId)) {
      deps.onWarning?.('no foreground virtual window for VW companion');
      return;
    }
    if (key === 'clipboard' || key === 'memo' || key === 'detail') {
      deps.openVwCompanion(windowId as number, key);
    }
  }
}
