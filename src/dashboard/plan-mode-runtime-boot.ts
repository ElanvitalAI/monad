import type { LLMMessage } from '../llm.js';

export interface DashboardPlanModeCleanupResult {
  removed: number;
}

export interface DashboardWorktreeCleanupDeps {
  cleanupStaleWorktreeSessions: () => DashboardPlanModeCleanupResult;
  onRemoved: (removed: number) => void;
}

export function cleanupDashboardWorktreeSessions(
  deps: DashboardWorktreeCleanupDeps,
): void {
  const res = deps.cleanupStaleWorktreeSessions();
  if (res.removed > 0) deps.onRemoved(res.removed);
}

export interface DashboardPlanModeHandoffDeps {
  compactConversation: (
    history: LLMMessage[],
    opts: { preserveLastN: number },
  ) => Promise<{ summary?: string } | null>;
  appendCompactToMemory: (summary: string) => Promise<unknown>;
  chatHistory: LLMMessage[];
  resetChatLines: () => void;
  clearAttachmentRows: () => void;
  clearLogSearch: () => void;
  pushSuccessLine: (message: string) => void;
  pushWarningLine: (message: string) => void;
  setChatScrollBottom: () => void;
  draw: () => void;
}

export function createDashboardPlanModeHandoff(
  deps: DashboardPlanModeHandoffDeps,
): (planBody: string, planFilePath: string, sessionId: string) => Promise<void> {
  return async (planBody, planFilePath, sessionId) => {
    try {
      const summary = await deps.compactConversation(
        deps.chatHistory,
        { preserveLastN: 0 },
      ).catch(() => null);
      if (summary?.summary) {
        try { await deps.appendCompactToMemory(summary.summary); } catch { /* non-fatal */ }
      }
      const systemMsg = deps.chatHistory.find((m) => m.role === 'system');
      deps.chatHistory.length = 0;
      if (systemMsg) deps.chatHistory.push(systemMsg);
      deps.chatHistory.push({
        role: 'user',
        content: `Previous plan (saved to ${planFilePath}, session ${sessionId}):\n\n${planBody}\n\nImplement this now.`,
      });
      deps.resetChatLines();
      deps.clearAttachmentRows();
      deps.clearLogSearch();
      deps.pushSuccessLine(`[compact] plan ${sessionId} loaded — implementation phase starts now.`);
      deps.setChatScrollBottom();
      try { deps.draw(); } catch { /* TUI torn down */ }
    } catch (err) {
      deps.pushWarningLine(`[compact] handoff failed: ${err instanceof Error ? err.message : String(err)}`);
      deps.setChatScrollBottom();
    }
  };
}

export interface DashboardPlanModeBootDeps {
  // 주입 setter — method 문법(bivariant 파라미터)이라 구체 setExitPlanModeDeps
  // (`ExitPlanModeDeps | null` 를 받고 coordinator 가 DisplayCoordinator·onHandoff
  // 가 optional `void | Promise<void>`)를 그대로 수용한다. arrow-property 는
  // contravariant 라 unknown coordinator·nullable 인자에서 튕긴다.
  setExitPlanModeDeps(deps: {
    coordinator: unknown;
    termSize: () => { cols: number; rows: number };
    onHandoff?: (planBody: string, planFilePath: string, sessionId: string) => void | Promise<void>;
  } | null): void;
  coordinator: unknown;
  termSize: () => { cols: number; rows: number };
  onHandoff: (planBody: string, planFilePath: string, sessionId: string) => Promise<void>;
}

export function bootDashboardPlanModeRuntime(
  deps: DashboardPlanModeBootDeps,
): void {
  deps.setExitPlanModeDeps({
    coordinator: deps.coordinator,
    termSize: deps.termSize,
    onHandoff: deps.onHandoff,
  });
}
