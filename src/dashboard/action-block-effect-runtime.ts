import type { DashboardActionApplyOutcome } from './action-block-runtime.js';

export interface DashboardActionBlockEffectRuntimeDeps {
  outcome: DashboardActionApplyOutcome;
  info: (text: string) => string;
  highlight: (text: string) => string;
  brainIcon: string;
  syncIcon: string;
  diffIcon: string;
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
  draw: () => void;
  runSyncInline: () => Promise<void>;
  runDiffInline: () => Promise<void>;
}

export async function runDashboardActionBlockEffects(
  deps: DashboardActionBlockEffectRuntimeDeps,
): Promise<void> {
  if (deps.outcome.applied.length) {
    deps.pushChatLine(
      deps.info(`${deps.brainIcon} Action applied: ${deps.outcome.applied.join(', ')}`),
    );
  }

  if (deps.outcome.autoRun === 'sync') {
    deps.pushChatLine(deps.highlight(`${deps.syncIcon} Auto-executing sync...`));
    deps.setChatScrollBottom();
    deps.draw();
    await deps.runSyncInline();
    return;
  }

  if (deps.outcome.autoRun === 'diff') {
    deps.pushChatLine(deps.highlight(`${deps.diffIcon} Auto-executing diff...`));
    deps.setChatScrollBottom();
    deps.draw();
    await deps.runDiffInline();
  }
}
