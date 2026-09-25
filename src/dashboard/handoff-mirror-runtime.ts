export interface DashboardHandoffMirrorRuntimeDeps {
  attachedSessionId: string | null;
  userContent: string;
  assistantContent: string;
  appendMessage: (
    sessionId: string,
    msg: { role: 'user' | 'assistant'; content: string; ts: string },
  ) => void;
  now?: () => string;
  onWarning: (message: string) => void;
}

export function runDashboardHandoffMirror(
  deps: DashboardHandoffMirrorRuntimeDeps,
): void {
  if (!deps.attachedSessionId) return;
  try {
    const ts = (deps.now ?? (() => new Date().toISOString()))();
    deps.appendMessage(deps.attachedSessionId, {
      role: 'user',
      content: deps.userContent,
      ts,
    });
    deps.appendMessage(deps.attachedSessionId, {
      role: 'assistant',
      content: deps.assistantContent,
      ts,
    });
  } catch (err: any) {
    deps.onWarning(`  (handoff mirror: ${err?.message ?? err})`);
  }
}
