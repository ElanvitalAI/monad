import { buildTurnOutputTextBlocks } from '../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../input/turn-output-sink-registry.js';

export interface DashboardAutoCopyQaStatus {
  kind: 'success' | 'failure';
  message: string;
}

export interface DashboardClipboardDetailedResult {
  ok: boolean;
  via?: 'osc52' | 'file' | string;
  path?: string | null;
  note?: string | null;
}

export function buildDashboardLogCopyPayload(
  chatLines: string[],
  stripAnsi: (line: string) => string,
): { plain: string; lineCount: number } | null {
  if (chatLines.length === 0) return null;
  const raw = chatLines.map(stripAnsi).join('\n');
  return {
    plain: selectTurnOutputTextForSink('clipboard', buildTurnOutputTextBlocks(raw)) ?? raw,
    lineCount: chatLines.length,
  };
}

export function buildDashboardAutoCopyQaPayload(
  question: string,
  answer: string,
): string {
  const raw = ['Q:', question, '', 'A:', answer].join('\n');
  return selectTurnOutputTextForSink('clipboard', buildTurnOutputTextBlocks(raw)) ?? raw;
}

export function buildDashboardScratchExportPayload(
  scratchLines: string[],
): string {
  const raw = scratchLines.join('\n') + '\n';
  return selectTurnOutputTextForSink('file-write', buildTurnOutputTextBlocks(raw)) ?? raw;
}

export function buildDashboardScratchCopyPayload(
  scratchLines: string[],
): string {
  const raw = scratchLines.join('\n');
  return selectTurnOutputTextForSink('clipboard', buildTurnOutputTextBlocks(raw)) ?? raw;
}

export function buildDashboardScratchDumpLines(
  scratchLines: string[],
): string[] {
  const raw = scratchLines.join('\n');
  const selected = selectTurnOutputTextForSink('log', buildTurnOutputTextBlocks(raw)) ?? raw;
  return selected.length === 0 ? [] : selected.split('\n');
}

export function buildDashboardEditorOpenPayload(
  absPath: string,
): string {
  return selectTurnOutputTextForSink('editor-open', buildTurnOutputTextBlocks(absPath)) ?? absPath;
}

export function buildDashboardBrowserOpenPayload(
  target: string,
): string {
  return selectTurnOutputTextForSink('browser-open', buildTurnOutputTextBlocks(target)) ?? target;
}

export function buildDashboardCopiedHudText(
  raw: string,
): string {
  return selectTurnOutputTextForSink('hud-phase', buildTurnOutputTextBlocks(raw)) ?? raw;
}

export function buildDashboardAutoCopyQaStatus(
  result: DashboardClipboardDetailedResult,
): DashboardAutoCopyQaStatus {
  if (result.ok) {
    const via =
      result.via === 'osc52' ? 'remote clipboard'
      : result.via === 'file' ? `clipboard file: ${result.path ?? 'saved'}`
      : 'clipboard';
    return {
      kind: 'success',
      message: `(auto-copied Q&A via ${via})`,
    };
  }
  const note = result.note ? ` — ${result.note}` : '';
  return {
    kind: 'failure',
    message: `(auto-copy Q&A failed${note})`,
  };
}
