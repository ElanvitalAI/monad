import {
  buildConversationPopupWorkspaceMembers,
  projectConversationPopups,
  type ConversationPopupHost,
  type ConversationPopupLayoutMode,
} from '../conv-dash/popup-host.js';
import type { DisplayCoordinator } from '../display/coordinator.js';
import type { WidgetHost } from '../widgets/host.js';
import type { SurfaceId } from '../display/types.js';

export interface ConversationPopupWorkspaceHost {
  // readonly member list — the concrete WorkspaceHost exposes a
  // `readonly WorkspaceMemberDescriptor[]`; this seam only iterates it.
  getWorkspace(id: string): { members: ReadonlyArray<{ surfaceId: string }> } | null | undefined;
  removeMember(ownerId: string, surfaceId: string): void;
  upsertMember(ownerId: string, member: {
    surfaceId: string;
    kind: 'popup';
    label: string;
    order: number;
    minimized: boolean;
    docked: boolean;
  }): void;
  setFocusedMember(ownerId: string, surfaceId: string | null): void;
}

export interface ConversationPopupModalHandle {
  dispose(): void;
}

export interface ConversationPopupRuntimeDeps<SessionEntry> {
  conversationPopupHost: Pick<
    ConversationPopupHost,
    'snapshot' | 'setLayoutMode' | 'restore' | 'focus' | 'cycleFocus' | 'remove' | 'minimize'
  >;
  pruneConversationPopupHost: () => void;
  ensureConversationWidgetMounted: (sessionId: string) => Promise<boolean>;
  termSize: () => { cols: number; rows: number };
  workspaceHost: ConversationPopupWorkspaceHost;
  resolveLayoutMode: (
    mode: ConversationPopupLayoutMode,
    cols: number,
    rows: number,
    liveCount: number,
  ) => ConversationPopupLayoutMode;
  listLiveSessions: () => readonly SessionEntry[];
  findSessionEntry: (entries: readonly SessionEntry[], sessionId: string) => SessionEntry | undefined;
  getSessionId: (entry: SessionEntry) => string;
  getWidgetId: (entry: SessionEntry) => string;
  getModalTitle: (entry: SessionEntry) => string;
  showModal: (opts: {
    id: SurfaceId;
    title: string;
    widgetId: string;
    cols: number;
    rows: number;
    bounds: { row: number; col: number; width: number; height: number };
    onDispose: () => void;
  }) => ConversationPopupModalHandle;
  draw: () => void;
}

export interface ConversationPopupRuntime {
  syncConversationPopupModals: () => void;
  setConversationPopupLayoutMode: (mode: ConversationPopupLayoutMode) => void;
  openConversationModal: (sessionId: string) => Promise<boolean>;
  focusConversationPopup: (direction: 1 | -1) => Promise<string | null>;
}

export function createConversationPopupRuntime<SessionEntry>(
  deps: ConversationPopupRuntimeDeps<SessionEntry>,
): ConversationPopupRuntime {
  const conversationModalHandles = new Map<string, ConversationPopupModalHandle>();
  let suppressConversationModalDispose = false;

  const syncConversationPopupModals = (): void => {
    deps.pruneConversationPopupHost();
    const { cols, rows } = deps.termSize();
    const snapshot = deps.conversationPopupHost.snapshot();
    const workspaceMembers = buildConversationPopupWorkspaceMembers(snapshot);
    const workspaceSurfaceIds = new Set(workspaceMembers.map((member) => member.surfaceId));
    const existingWorkspace = deps.workspaceHost.getWorkspace('dashboard-main');
    for (const member of existingWorkspace?.members ?? []) {
      if (member.surfaceId.startsWith('conversation-modal:') && !workspaceSurfaceIds.has(member.surfaceId)) {
        deps.workspaceHost.removeMember('dashboard-main', member.surfaceId);
      }
    }
    for (const member of workspaceMembers) {
      deps.workspaceHost.upsertMember('dashboard-main', {
        surfaceId: member.surfaceId,
        kind: 'popup',
        label: member.label,
        order: member.order,
        minimized: member.minimized,
        docked: member.docked,
      });
    }
    const focusedConversationSurfaceId = snapshot.focusedSessionId
      ? `conversation-modal:${snapshot.focusedSessionId}`
      : null;
    deps.workspaceHost.setFocusedMember('dashboard-main', focusedConversationSurfaceId);
    const effectiveLayoutMode = deps.resolveLayoutMode(
      snapshot.layoutMode,
      cols,
      rows,
      snapshot.live.length,
    );
    const liveFrames = projectConversationPopups(
      snapshot.live,
      effectiveLayoutMode,
      cols,
      rows,
      snapshot.focusedSessionId,
    );
    suppressConversationModalDispose = true;
    try {
      for (const handle of conversationModalHandles.values()) handle.dispose();
      conversationModalHandles.clear();
    } finally {
      suppressConversationModalDispose = false;
    }
    for (const frame of liveFrames) {
      const entry = deps.findSessionEntry(deps.listLiveSessions(), frame.sessionId);
      if (!entry) continue;
      const sessionId = deps.getSessionId(entry);
      const handle = deps.showModal({
        id: `conversation-modal:${sessionId}`,
        title: deps.getModalTitle(entry),
        widgetId: deps.getWidgetId(entry),
        cols,
        rows,
        bounds: {
          row: frame.row,
          col: frame.col,
          width: frame.width,
          height: frame.height,
        },
        onDispose: () => {
          if (suppressConversationModalDispose) return;
          deps.conversationPopupHost.minimize(sessionId);
          syncConversationPopupModals();
          deps.draw();
        },
      });
      conversationModalHandles.set(sessionId, handle);
    }
  };

  return {
    syncConversationPopupModals,
    setConversationPopupLayoutMode: (mode) => {
      deps.conversationPopupHost.setLayoutMode(mode);
      syncConversationPopupModals();
    },
    openConversationModal: async (sessionId) => {
      const mounted = await deps.ensureConversationWidgetMounted(sessionId);
      if (!mounted) return false;
      deps.conversationPopupHost.restore(sessionId);
      deps.conversationPopupHost.focus(sessionId);
      syncConversationPopupModals();
      return true;
    },
    focusConversationPopup: async (direction) => {
      const sessionId = deps.conversationPopupHost.cycleFocus(direction);
      if (!sessionId) return null;
      const mounted = await deps.ensureConversationWidgetMounted(sessionId);
      if (!mounted) {
        deps.conversationPopupHost.remove(sessionId);
        syncConversationPopupModals();
        return null;
      }
      syncConversationPopupModals();
      return sessionId;
    },
  };
}
