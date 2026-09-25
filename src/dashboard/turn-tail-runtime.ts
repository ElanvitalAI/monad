export interface DashboardAssistantRenderState {
  lastAssistantRaw: string | null;
  lastAssistantRange: { start: number; end: number } | null;
  lastAssistantMode: 'rendered' | 'raw';
}

export interface DashboardTurnTailAutoCopyDeps {
  enabled: boolean;
  userText: string;
  fullResponse: string;
  autoCopyTurnQaToClipboard: (userText: string, fullResponse: string) => Promise<void>;
  onWarning: (message: string) => void;
}

export function commitDashboardAssistantRenderState(
  fullResponse: string,
  assistantStart: number,
  chatLineCount: number,
): DashboardAssistantRenderState {
  return {
    lastAssistantRaw: fullResponse,
    lastAssistantRange: { start: assistantStart, end: chatLineCount },
    lastAssistantMode: 'rendered',
  };
}

export async function runDashboardTurnTailAutoCopy(
  deps: DashboardTurnTailAutoCopyDeps,
): Promise<void> {
  if (!deps.enabled) return;
  try {
    await deps.autoCopyTurnQaToClipboard(deps.userText, deps.fullResponse);
  } catch (err: any) {
    deps.onWarning(`(auto-copy Q&A error: ${err?.message ?? String(err)})`);
  }
}
