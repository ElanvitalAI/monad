import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import {
  runDashboardAssistantCodeCopy,
  runDashboardAssistantCopy,
  runDashboardAutoCopyQa,
  runDashboardLogCopy,
} from './copy-feedback-runtime.js';

export interface DashboardCopyRuntimeDeps {
  chatLines: string[];
  setChatScrollBottom: () => void;
  draw: () => void;
  muted: (text: string) => string;
  warning: (text: string) => string;
  getAssistantState: () => DashboardAssistantRenderState;
  stripAnsi: (line: string) => string;
  writeClipboard: (plain: string) => Promise<boolean>;
  writeClipboardDetailed: (plain: string) => Promise<{
    ok: boolean;
    via?: 'osc52' | 'file' | string;
    path?: string | null;
    note?: string | null;
  }>;
}

export interface DashboardCopyRuntime {
  copyLastAssistantTurnToClipboard: () => Promise<void>;
  copyLastAssistantCodeToClipboard: () => Promise<void>;
  autoCopyTurnQaToClipboard: (question: string, answer: string) => Promise<void>;
  copyLogPaneToClipboard: () => Promise<void>;
}

export function createDashboardCopyRuntime(
  deps: DashboardCopyRuntimeDeps,
): DashboardCopyRuntime {
  return {
    copyLastAssistantTurnToClipboard: () => runDashboardAssistantCopy({
      chatLines: deps.chatLines,
      setChatScrollBottom: deps.setChatScrollBottom,
      draw: deps.draw,
      muted: deps.muted,
      warning: deps.warning,
      state: deps.getAssistantState(),
      stripAnsi: deps.stripAnsi,
      writeClipboard: deps.writeClipboard,
    }),
    copyLastAssistantCodeToClipboard: () => runDashboardAssistantCodeCopy({
      chatLines: deps.chatLines,
      setChatScrollBottom: deps.setChatScrollBottom,
      draw: deps.draw,
      muted: deps.muted,
      warning: deps.warning,
      state: deps.getAssistantState(),
      writeClipboard: deps.writeClipboard,
    }),
    autoCopyTurnQaToClipboard: (question, answer) => runDashboardAutoCopyQa({
      chatLines: deps.chatLines,
      setChatScrollBottom: deps.setChatScrollBottom,
      draw: deps.draw,
      muted: deps.muted,
      warning: deps.warning,
      question,
      answer,
      writeClipboardDetailed: deps.writeClipboardDetailed,
    }),
    copyLogPaneToClipboard: () => runDashboardLogCopy({
      chatLines: deps.chatLines,
      setChatScrollBottom: deps.setChatScrollBottom,
      draw: deps.draw,
      muted: deps.muted,
      warning: deps.warning,
      stripAnsi: deps.stripAnsi,
      writeClipboard: deps.writeClipboard,
    }),
  };
}
