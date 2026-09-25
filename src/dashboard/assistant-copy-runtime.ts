import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import {
  buildTurnOutputTextBlocks,
  selectCodeTextBlock,
} from '../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../input/turn-output-sink-registry.js';

export interface DashboardAssistantCopyPayload {
  plain: string;
  lineCount: number;
}

export interface DashboardAssistantCodeCopyPayload {
  plain: string;
  lineCount: number;
}

export function buildDashboardAssistantCopyPayload(
  state: DashboardAssistantRenderState,
  chatLines: string[],
  stripAnsi: (line: string) => string,
): DashboardAssistantCopyPayload | null {
  if (state.lastAssistantRaw !== null) {
    const plain = selectTurnOutputTextForSink(
      'clipboard',
      buildTurnOutputTextBlocks(state.lastAssistantRaw),
    ) ?? state.lastAssistantRaw;
    return {
      plain,
      lineCount: plain.split('\n').length,
    };
  }

  let start = 0;
  for (let i = chatLines.length - 1; i >= 0; i--) {
    if (stripAnsi(chatLines[i]!).startsWith('\u276f ')) {
      start = i + 1;
      break;
    }
  }
  while (start < chatLines.length && chatLines[start] === '') start++;
  const toCopy = chatLines.slice(start);
  if (toCopy.length === 0) return null;
  const plain = selectTurnOutputTextForSink(
    'clipboard',
    buildTurnOutputTextBlocks(toCopy.map(stripAnsi).join('\n')),
  ) ?? toCopy.map(stripAnsi).join('\n');
  return {
    plain,
    lineCount: toCopy.length,
  };
}

export function buildDashboardAssistantCodeCopyPayload(
  state: DashboardAssistantRenderState,
): DashboardAssistantCodeCopyPayload | null {
  if (state.lastAssistantRaw === null) return null;
  const blocks = buildTurnOutputTextBlocks(state.lastAssistantRaw);
  if (!selectCodeTextBlock(blocks)) return null;
  const plain = selectTurnOutputTextForSink('code', blocks) ?? state.lastAssistantRaw;
  return {
    plain,
    lineCount: plain.split('\n').length,
  };
}
