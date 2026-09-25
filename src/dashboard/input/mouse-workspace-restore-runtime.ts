import { parseCompanionSurfaceId } from '../companion-surface-address.js';
import type { DashboardMouseWiringDeps } from './mouse-wiring.js';

interface WorkspaceHostLike {
  restoreMember(ownerId: string, surfaceId: string): void;
}

interface CompanionPopupHostLike {
  ownerId: string;
  includes(key: string): boolean;
  markOpen(key: string): void;
}

export interface MouseWorkspaceRestoreRuntimeDeps {
  workspaceHost: WorkspaceHostLike;
  companionPopupHost: CompanionPopupHostLike;
  openDebugWindow: () => void;
  openDebugWorkbenchModal: () => void;
  syncCompanionPopups: () => void;
  openConversationModal: (sessionId: string) => Promise<boolean>;
  redraw: () => void;
}

export interface MouseWorkspaceRestoreRuntime
  extends Pick<DashboardMouseWiringDeps, 'onWorkspaceRestore'> {}

export function createMouseWorkspaceRestoreRuntime(
  deps: MouseWorkspaceRestoreRuntimeDeps,
): MouseWorkspaceRestoreRuntime {
  return {
    onWorkspaceRestore: async (surfaceId) => {
      if (surfaceId === 'debug-window') {
        deps.workspaceHost.restoreMember('dashboard-main', surfaceId);
        deps.openDebugWindow();
        deps.redraw();
        return;
      }
      if (surfaceId === 'debug-workbench') {
        deps.workspaceHost.restoreMember('dashboard-main', surfaceId);
        deps.openDebugWorkbenchModal();
        deps.redraw();
        return;
      }
      const companionAddress = parseCompanionSurfaceId(surfaceId);
      if (companionAddress && companionAddress.ownerId === deps.companionPopupHost.ownerId) {
        const key = companionAddress.key;
        if (deps.companionPopupHost.includes(key)) {
          deps.companionPopupHost.markOpen(key);
          deps.syncCompanionPopups();
          deps.redraw();
          return;
        }
      }
      if (surfaceId.startsWith('conversation-modal:')) {
        const sessionId = surfaceId.slice('conversation-modal:'.length);
        await deps.openConversationModal(sessionId);
        deps.redraw();
        return;
      }
      deps.workspaceHost.restoreMember('dashboard-main', surfaceId);
      deps.redraw();
    },
  };
}
