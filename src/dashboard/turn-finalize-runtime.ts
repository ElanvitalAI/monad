import type { ThinkingHandle } from '../thinking-line.js';
import { resolveDashboardExecutionBadge } from './execution-badge.js';

export interface DashboardTurnFinalizeRuntimeDeps {
  thinking: ThinkingHandle;
  finalStatus: 'completed' | 'interrupted' | 'failed';
  finalError?: string;
  /** Compact TRUE-execution badge for the completion line (self
   *  `🧠 terra(high)` vs delegate `🤖 acp-codex`). Folded into the
   *  thinking metrics just before freeze so the frozen line shows the
   *  real backend, not the config original. Override seam for tests;
   *  when omitted, resolved from the live route decision. Pass an empty
   *  string to suppress the badge entirely. */
  engineBadge?: string;
  chatFooterLine: { current: string | null };
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
  consumeQuickControl: () => boolean;
  muted: (text: string) => string;
  draw: () => void;
}

export function finalizeDashboardTurn(
  deps: DashboardTurnFinalizeRuntimeDeps,
): void {
  // Fold the TRUE-execution badge into the metrics so the frozen
  // completion line renders `… · 🧠 terra(high)` / `🤖 acp-codex`.
  // Default-resolve from the live route decision; deps.engineBadge is a
  // test/override seam ('' suppresses).
  const engineBadge = deps.engineBadge ?? resolveDashboardExecutionBadge();
  if (engineBadge) deps.thinking.updateMetrics({ engine: engineBadge });
  deps.thinking.stop({ status: deps.finalStatus, errorText: deps.finalError });
  const finalMarker = deps.chatFooterLine.current;
  if (finalMarker) {
    deps.pushChatLine('');
    deps.pushChatLine(finalMarker);
  }
  deps.chatFooterLine.current = null;
  deps.setChatScrollBottom();
  if (deps.consumeQuickControl()) {
    deps.pushChatLine(deps.muted('  (quick-control consumed — back to chat)'));
    deps.setChatScrollBottom();
  }
  deps.draw();
}
