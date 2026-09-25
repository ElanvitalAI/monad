import type { InputResult } from '../../chat/index.js';
import { resolveDashboardChatMainLoopControl, type DashboardChatMainLoopControl } from './chat-main-loop-control.js';

export interface DashboardChatMainHistoryRecord {
  text: string;
  cwd: string;
  activeView: string;
  focusedPane: string;
  metadata: {
    chatOnlyMode: boolean;
    provider: string | null;
  };
}

export interface DashboardChatMainPostTurnResult {
  shouldResetInputLines: boolean;
  nextInitialText: undefined;
  loopControl: DashboardChatMainLoopControl;
  historyRecord: DashboardChatMainHistoryRecord | null;
}

export function resolveDashboardChatMainPostTurn(
  input: InputResult,
  deps: {
    inputLines: number;
    isChatOnlyMode: boolean;
    hasActiveSessionControl: boolean;
    lastHistoryEntry?: string;
    cwd: string;
    activeViewId: string;
    focusedPane: string;
    provider: string | null;
  },
): DashboardChatMainPostTurnResult {
  const loopControl = resolveDashboardChatMainLoopControl(input, {
    isChatOnlyMode: deps.isChatOnlyMode,
    hasActiveSessionControl: deps.hasActiveSessionControl,
  });

  const shouldRecordHistory =
    loopControl.kind === 'submit'
    && deps.lastHistoryEntry !== input.text;

  return {
    shouldResetInputLines: deps.inputLines !== 1,
    nextInitialText: undefined,
    loopControl,
    historyRecord: shouldRecordHistory
      ? {
        text: input.text,
        cwd: deps.cwd,
        activeView: deps.activeViewId,
        focusedPane: deps.focusedPane,
        metadata: {
          chatOnlyMode: deps.isChatOnlyMode,
          provider: deps.provider,
        },
      }
      : null,
  };
}
