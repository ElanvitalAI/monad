import type { RunDashboardSubmitActionDeps } from './input/submit-actions.js';
import { formatDashboardSidebarSelectedSession, resolveDashboardSidebarPromoteToVw } from './sidebar-session-selection.js';
import { formatDashboardSidebarToolbeltAction } from './sidebar-toolbelt-action.js';

export interface DashboardSidebarSubmitRuntimeDeps {
  onChangeWorkingDir: (absPath: string, browserId?: string) => void;
  onAttachFile: (absPath: string, browserId?: string) => void;
  onAttachFolder: (absPath: string, browserId?: string) => void;
  getStatusRecord: (sessionId: string) => {
    status: string;
    updatedAt: number;
    lastEvent?: string | null;
  } | undefined;
  attachBlock: (sessionId: string) =>
    | { kind: 'no-block' }
    | { kind: 'attached'; attachmentId: string; lines: number; bytes: number; total: number };
  markSessionRead: (sessionId: string) => void;
  refreshSessionCards: () => void;
  getBackgroundSessionState: (sessionId: string) => string | null | undefined;
  terminalBackgroundStates: readonly string[];
  runSessionJoin: (sessionId: string, promoteToVW: boolean) => void;
  pushMutedLine: (line: string) => void;
  pushInfoLine: (line: string) => void;
  pushLogText: (line: string) => void;
}

export function createDashboardSidebarSubmitRuntime(
  deps: DashboardSidebarSubmitRuntimeDeps,
): RunDashboardSubmitActionDeps {
  return {
    onChangeWorkingDir: deps.onChangeWorkingDir,
    onAttachFile: deps.onAttachFile,
    onAttachFolder: deps.onAttachFolder,
    onToolbeltAction: (action, sessionId) => {
      const outcome = formatDashboardSidebarToolbeltAction(action, sessionId, {
        // Store sentinel for "no record" is `undefined`; the toolbelt
        // formatter's contract uses `null`. Bridge at this boundary.
        getStatusRecord: (id) => deps.getStatusRecord(id) ?? null,
        attachBlock: deps.attachBlock,
      });
      if (outcome.tone === 'info') deps.pushInfoLine(outcome.message);
      else deps.pushMutedLine(outcome.message);
    },
    onSelectSession: (sessionId) => {
      deps.markSessionRead(sessionId);
      deps.refreshSessionCards();
      if (sessionId.startsWith('acp-bg:')) {
        const promoteToVW = resolveDashboardSidebarPromoteToVw(
          deps.getBackgroundSessionState(sessionId),
          deps.terminalBackgroundStates,
        );
        deps.runSessionJoin(sessionId, promoteToVW);
        return;
      }
      const outcome = formatDashboardSidebarSelectedSession(sessionId);
      deps.pushMutedLine(outcome.message);
    },
    onLogText: deps.pushLogText,
  };
}
