export interface DashboardSidebarJoinResult {
  promoted?: boolean;
  windowId?: number;
  paneId?: string;
  fullOutput: string;
  state: string;
  stopReason?: string;
  error?: string;
}

export function formatDashboardSidebarJoinResult(
  sessionId: string,
  result: DashboardSidebarJoinResult,
): { tone: 'info'; message: string } {
  if (result.promoted && result.windowId !== undefined && result.paneId !== undefined) {
    return {
      tone: 'info',
      message: `[sidebar · promoted] ${sessionId} → W${result.windowId} / ${result.paneId}`,
    };
  }
  const kb = (result.fullOutput.length / 1024).toFixed(1);
  const reason = result.stopReason ? ` (${result.stopReason})` : '';
  const err = result.error ? ` · err: ${result.error}` : '';
  return {
    tone: 'info',
    message: `[sidebar · joined] ${sessionId} — ${result.state}${reason} · ${kb}KB${err}`,
  };
}

export function formatDashboardSidebarJoinError(
  sessionId: string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[sidebar · join failed] ${sessionId}: ${message}`;
}

export function formatDashboardSidebarSelectedSession(
  sessionId: string,
): { tone: 'muted'; message: string } {
  return {
    tone: 'muted',
    message: `[sidebar] selected ${sessionId} (focus hop TBD).`,
  };
}

export function resolveDashboardSidebarPromoteToVw(
  state: string | null | undefined,
  terminalStates: readonly string[],
): boolean {
  if (!state) return false;
  return !terminalStates.includes(state);
}
