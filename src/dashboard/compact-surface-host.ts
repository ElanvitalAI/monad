import type { PaneFocus } from '../workspace-types.js';
import type { DashboardViewDef } from '../views/config.js';
import type { ProductCompactMode } from '../views/product-compact-mode.js';
import type {
  DashboardSurfaceCatalogTarget,
  DashboardViewPickerEntry,
} from './compact-surface-inventory.js';
import { buildDashboardViewPickerEntries } from './compact-surface-inventory.js';

export interface CreateCompactSurfaceHostDeps {
  buildDockSurfaceCatalogTargets: () => DashboardSurfaceCatalogTarget[];
  openCatalogSurfaceById: (surfaceId: string) => void;
  setChatOnlyMode: (next: boolean) => void;
  getChatOnlyMode: () => boolean;
  onChatOnlyEnabled: () => void;
  onChatOnlyDisabled: () => void;
  describeViewStarterPackage: (view: DashboardViewDef) => string;
  getViews: () => DashboardViewDef[];
  getActiveViewId: () => string;
  getClosedStarterCount: () => number;
  getCompactMode: () => ProductCompactMode;
  restoreStarterPanes: () => void;
  resetDashboardViewsConfig: () => void;
  activateView: (view: DashboardViewDef) => void;
}

export interface CompactSurfaceHost {
  getDockMenuSurfaceTargets: () => DashboardSurfaceCatalogTarget[];
  openDockSurface: (surfaceId: string) => void;
  toggleChatOnly: () => void;
  getDashboardViews: () => DashboardViewPickerEntry[];
  applyDashboardView: (viewId: string) => void;
}

export function createCompactSurfaceHost(
  deps: CreateCompactSurfaceHostDeps,
): CompactSurfaceHost {
  return {
    getDockMenuSurfaceTargets: () => deps.buildDockSurfaceCatalogTargets(),
    openDockSurface: (surfaceId) => {
      deps.openCatalogSurfaceById(surfaceId);
    },
    toggleChatOnly: () => {
      const next = !deps.getChatOnlyMode();
      deps.setChatOnlyMode(next);
      if (next) deps.onChatOnlyEnabled();
      else deps.onChatOnlyDisabled();
    },
    getDashboardViews: () =>
      buildDashboardViewPickerEntries({
        views: deps.getViews().map((view) => ({
          id: view.id,
          label: view.label,
          active: view.id === deps.getActiveViewId(),
        })),
        includeRestoreAction: deps.getClosedStarterCount() > 0,
        compactMode: deps.getCompactMode(),
      }),
    applyDashboardView: (viewId) => {
      if (viewId === 'action:view-restore') {
        deps.restoreStarterPanes();
        return;
      }
      if (viewId === 'action:view-reset') {
        deps.resetDashboardViewsConfig();
        return;
      }
      const next = deps.getViews().find((view) => view.id === viewId);
      if (next) deps.activateView(next);
    },
  };
}
