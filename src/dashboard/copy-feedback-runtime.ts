import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import {
  buildDashboardAssistantCodeCopyPayload,
  buildDashboardAssistantCopyPayload,
} from './assistant-copy-runtime.js';
import {
  buildDashboardAutoCopyQaPayload,
  buildDashboardAutoCopyQaStatus,
  buildDashboardLogCopyPayload,
  type DashboardClipboardDetailedResult,
} from './clipboard-message-runtime.js';

export interface DashboardCopyFeedbackRuntimeDeps {
  chatLines: string[];
  setChatScrollBottom: () => void;
  draw: () => void;
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export async function runDashboardAssistantCopy(
  deps: DashboardCopyFeedbackRuntimeDeps & {
    state: DashboardAssistantRenderState;
    stripAnsi: (line: string) => string;
    writeClipboard: (plain: string) => Promise<boolean>;
  },
): Promise<void> {
  const payload = buildDashboardAssistantCopyPayload(deps.state, deps.chatLines, deps.stripAnsi);
  if (!payload) {
    deps.chatLines.push(deps.warning('(nothing to copy)'));
    deps.setChatScrollBottom();
    deps.draw();
    return;
  }
  const ok = await deps.writeClipboard(payload.plain);
  deps.chatLines.push(ok
    ? deps.muted(`(copied ${payload.lineCount} lines, raw markdown)`)
    : deps.warning('(clipboard write failed — install xclip/wl-copy?)'));
  deps.setChatScrollBottom();
  deps.draw();
}

export async function runDashboardAssistantCodeCopy(
  deps: DashboardCopyFeedbackRuntimeDeps & {
    state: DashboardAssistantRenderState;
    writeClipboard: (plain: string) => Promise<boolean>;
  },
): Promise<void> {
  const payload = buildDashboardAssistantCodeCopyPayload(deps.state);
  if (!payload) {
    deps.chatLines.push(deps.warning('(no code block to copy)'));
    deps.setChatScrollBottom();
    deps.draw();
    return;
  }
  const ok = await deps.writeClipboard(payload.plain);
  deps.chatLines.push(ok
    ? deps.muted(`(copied ${payload.lineCount} code lines)`)
    : deps.warning('(clipboard write failed — install xclip/wl-copy?)'));
  deps.setChatScrollBottom();
  deps.draw();
}

export async function runDashboardLogCopy(
  deps: DashboardCopyFeedbackRuntimeDeps & {
    stripAnsi: (line: string) => string;
    writeClipboard: (plain: string) => Promise<boolean>;
  },
): Promise<void> {
  const payload = buildDashboardLogCopyPayload(deps.chatLines, deps.stripAnsi);
  if (!payload) {
    deps.chatLines.push(deps.warning('(log is empty — nothing to copy)'));
    deps.setChatScrollBottom();
    deps.draw();
    return;
  }
  const ok = await deps.writeClipboard(payload.plain);
  deps.chatLines.push(ok
    ? deps.muted(`(copied ${payload.lineCount} log lines)`)
    : deps.warning('(clipboard write failed — install xclip/wl-copy?)'));
  deps.setChatScrollBottom();
  deps.draw();
}

export async function runDashboardAutoCopyQa(
  deps: DashboardCopyFeedbackRuntimeDeps & {
    question: string;
    answer: string;
    writeClipboardDetailed: (plain: string) => Promise<DashboardClipboardDetailedResult>;
  },
): Promise<void> {
  const q = deps.question.trim();
  const a = deps.answer.trim();
  if (!q || !a) return;
  const plain = buildDashboardAutoCopyQaPayload(q, a);
  const result = await deps.writeClipboardDetailed(plain);
  const status = buildDashboardAutoCopyQaStatus(result);
  deps.chatLines.push(
    status.kind === 'success'
      ? deps.muted(status.message)
      : deps.warning(status.message),
  );
  deps.setChatScrollBottom();
  deps.draw();
}
