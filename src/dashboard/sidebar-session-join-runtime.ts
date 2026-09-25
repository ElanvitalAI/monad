import {
  formatDashboardSidebarJoinError,
  formatDashboardSidebarJoinResult,
} from './sidebar-session-selection.js';

export interface DashboardSidebarJoinDispatchResult {
  promoted?: boolean;
  windowId?: number;
  paneId?: string;
  fullOutput: string;
  state: string;
  stopReason?: string;
  error?: string;
}

export interface DashboardSidebarSessionJoinRuntimeDeps {
  dispatchJoin: (args: { backgroundId: string; promoteToVW: boolean }) => Promise<DashboardSidebarJoinDispatchResult>;
  pushInfo: (message: string) => void;
  pushError: (message: string) => void;
  afterSettle: () => void;
}

export function runDashboardSidebarSessionJoin(
  sessionId: string,
  promoteToVW: boolean,
  deps: DashboardSidebarSessionJoinRuntimeDeps,
): void {
  void deps.dispatchJoin({ backgroundId: sessionId, promoteToVW })
    .then((result) => {
      const outcome = formatDashboardSidebarJoinResult(sessionId, result);
      deps.pushInfo(outcome.message);
      deps.afterSettle();
    })
    .catch((error) => {
      deps.pushError(formatDashboardSidebarJoinError(sessionId, error));
      deps.afterSettle();
    });
}
