import type { ThemeTokens } from '../theme/tokens.js';
import { attachSurfaceToWorkspace } from '../display/workspace-affinity.js';
import type { ShellRegistry } from '../shell-runner/registry.js';
import type { ShellHandle } from '../shell-runner/types.js';
import {
  createShellRollupPopupRecipe,
  type ShellRollupEntry,
  type ShellRollupRecipeOpts,
} from '../mouse-action-recipes.js';
import { renderHandleStatusChip } from '../status/chip.js';
import {
  decideAttach,
  type AttachRoutingDeps,
  type AttachOutcome,
} from '../shell-runner/attach-routing.js';

export interface OpenDashboardShellRollupPopupDeps {
  getShellRegistry: () => ShellRegistry;
  getCurrentDispose: () => (() => void) | null;
  setCurrentDispose: (dispose: (() => void) | null) => void;
  resolveVwIdByLabel: (label: string) => number | null;
  switchVirtualWindow: (windowId: number) => void;
  ownerWorkspaceId?: string;
  termSize: () => { cols: number; rows: number };
  getTheme: () => ThemeTokens | undefined;
  pushModalSurface: (surface: import('../display/modal-stack.js').ModalSurface) => { dispose: () => void };
  onEmpty: () => void;
  onWarning: (message: string) => void;
  redraw: () => void;
  createShellRollupPopupRecipe?: (opts: ShellRollupRecipeOpts) => import('../ui/modal-adapter.js').ViewSurfaceHandle;
  renderHandleStatusChip?: (status: ShellHandle['status']) => string;
  decideAttach?: (shell: ShellHandle, deps: AttachRoutingDeps) => AttachOutcome;
}

export async function openDashboardShellRollupPopup(
  deps: OpenDashboardShellRollupPopupDeps,
): Promise<void> {
  const existing = deps.getCurrentDispose();
  if (existing) {
    try { existing(); } catch { /* ignore */ }
    deps.setCurrentDispose(null);
  }

  const reg = deps.getShellRegistry();
  const entries: ShellRollupEntry[] = reg.list().map((h) => ({
    id: h.id,
    chip: (deps.renderHandleStatusChip ?? renderHandleStatusChip)(h.status),
    mode: h.mode,
    status: h.status,
    label: reg.getVwLabel(h.id) ?? undefined,
  }));
  if (entries.length === 0) {
    deps.onEmpty();
    deps.redraw();
    return;
  }

  const { cols, rows } = deps.termSize();
  const createRecipe = deps.createShellRollupPopupRecipe ?? createShellRollupPopupRecipe;
  const placement = {
    anchorStartCol: Math.max(0, Math.floor(cols / 2) - 20),
    anchorEndCol: Math.min(cols, Math.floor(cols / 2) + 20),
    statusRow: Math.floor(rows / 2),
    termCols: cols,
    termRows: rows,
  };
  const theme = deps.getTheme();
  const close = (dispose: (() => void) | null): void => {
    if (dispose) {
      try { dispose(); } catch { /* ignore */ }
    }
    deps.setCurrentDispose(null);
    deps.redraw();
  };

  const handle = createRecipe({
    entries,
    placement,
    onPick: (id) => {
      const shell = reg.get(id);
      if (!shell) return;
      routeAttach(shell, deps, reg);
      close(deps.getCurrentDispose());
    },
    onCancel: () => {
      close(deps.getCurrentDispose());
    },
    shadow: process.env.ELANOUS_MODAL_SHADOW === 'off'
      ? undefined
      : (theme ? { theme } : undefined),
  });
  handle.surface.onKey = (ev) => handle.handleKey(ev);
  attachSurfaceToWorkspace(handle.surface, deps.ownerWorkspaceId);
  const modal = deps.pushModalSurface(handle.surface);
  deps.setCurrentDispose(() => {
    handle.dispose();
    modal.dispose();
  });
  deps.redraw();
}

function routeAttach(
  shell: ShellHandle,
  deps: Pick<OpenDashboardShellRollupPopupDeps, 'resolveVwIdByLabel' | 'switchVirtualWindow' | 'onWarning' | 'decideAttach'>,
  reg: Pick<ShellRegistry, 'getVwLabel'>,
): void {
  const outcome = (deps.decideAttach ?? decideAttach)(shell, {
    getVwLabel: (id) => reg.getVwLabel(id),
    resolveVwIdByLabel: deps.resolveVwIdByLabel,
  });
  if (outcome.kind === 'switch-vw') {
    deps.switchVirtualWindow(outcome.windowId);
  } else {
    deps.onWarning(outcome.reason);
  }
}
