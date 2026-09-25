export interface DashboardCodeEditTurnRuntimeDeps {
  importCodeEdit: () => Promise<{
    getSourceDeltaManager: () => {
      beginTurn: (meta?: { promptPreview?: string; startedAt?: string }) => void;
    };
    getTurnDiffTracker: () => {
      beginTurn: () => void;
    };
  }>;
}

export function formatDashboardTurnPromptPreview(userText: string): string {
  return userText.length <= 60 ? userText : `${userText.slice(0, 59)}…`;
}

export async function beginDashboardCodeEditTurn(
  userContent: string,
  deps: DashboardCodeEditTurnRuntimeDeps,
): Promise<void> {
  try {
    const { getSourceDeltaManager, getTurnDiffTracker } = await deps.importCodeEdit();
    getSourceDeltaManager().beginTurn({
      promptPreview: formatDashboardTurnPromptPreview(userContent),
    });
    getTurnDiffTracker().beginTurn();
  } catch {
    // Code-edit tracking is opportunistic; turn flow should continue.
  }
}
