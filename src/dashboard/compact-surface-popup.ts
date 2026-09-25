import type { ViewSurfaceHandle } from '../ui/modal-adapter.js';
import { attachSurfaceToWorkspace } from '../display/workspace-affinity.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { DashboardSurfaceCatalogTarget } from './compact-surface-inventory.js';
import type { SurfaceCatalogRecipeOpts } from '../mouse-action-recipes.js';

export interface OpenCompactSurfaceCatalogPopupDeps {
  getTargets: () => DashboardSurfaceCatalogTarget[];
  openTarget: (surfaceId: string) => void;
  ownerWorkspaceId?: string;
  termSize: () => { cols: number; rows: number };
  getTheme: () => ThemeTokens | undefined;
  pushModalSurface: (surface: import('../display/modal-stack.js').ModalSurface) => { dispose: () => void };
  onEmptyTargets: () => void;
  redraw: () => void;
  createSurfaceCatalogRecipe?: (opts: SurfaceCatalogRecipeOpts) => ViewSurfaceHandle;
}

export async function openCompactSurfaceCatalogPopup(
  deps: OpenCompactSurfaceCatalogPopupDeps,
): Promise<void> {
  const targets = deps.getTargets();
  if (targets.length === 0) {
    deps.onEmptyTargets();
    deps.redraw();
    return;
  }

  const createSurfaceCatalogRecipe =
    deps.createSurfaceCatalogRecipe
    ?? (await import('../mouse-action-recipes.js')).createSurfaceCatalogRecipe;
  const { cols, rows } = deps.termSize();
  const theme = deps.getTheme();
  let handle: { dispose: () => void } | null = null;

  const picker: ViewSurfaceHandle = createSurfaceCatalogRecipe({
    surfaces: targets,
    placement: {
      anchorStartCol: Math.max(0, Math.floor(cols / 2) - 6),
      anchorEndCol: Math.min(cols - 1, Math.floor(cols / 2) + 6),
      statusRow: Math.max(2, Math.floor(rows / 2)),
      termCols: cols,
      termRows: rows,
    },
    onPick: async (surfaceId) => {
      deps.openTarget(surfaceId);
      handle?.dispose();
      deps.redraw();
    },
    onCancel: () => {
      handle?.dispose();
      deps.redraw();
    },
    theme,
    shadow: theme ? { theme } : undefined,
  });

  attachSurfaceToWorkspace(picker.surface, deps.ownerWorkspaceId);
  handle = deps.pushModalSurface(picker.surface);
  deps.redraw();
}
