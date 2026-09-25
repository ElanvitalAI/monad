import type { PromptFrame } from './prompt-frame.js';
import { bottomFixedRowsForPromptFrame } from './prompt-frame.js';

export interface PromptFrameLogViewportBounds {
  startRow: number;
  endRow: number;
  height: number;
}

export function computePromptFrameGridHeight(
  termRows: number,
  promptFrame: PromptFrame,
): number {
  return Math.max(3, termRows - 1 /* hud */ - bottomFixedRowsForPromptFrame(promptFrame.inputHeight));
}

export function computePromptFrameLogEndRow(
  termRows: number,
  promptFrame: PromptFrame,
): number {
  return termRows - promptFrame.inputHeight;
}

export function computePromptFrameLogViewportHeight(
  termRows: number,
  paneHeight: number,
  promptFrame: PromptFrame,
): number {
  return Math.max(3, computePromptFrameLogEndRow(termRows, promptFrame) - paneHeight - 1);
}

export function computePromptFrameLogViewportBounds(
  termRows: number,
  paneHeight: number,
  promptFrame: PromptFrame,
): PromptFrameLogViewportBounds {
  return {
    startRow: paneHeight + 1,
    endRow: computePromptFrameLogEndRow(termRows, promptFrame),
    height: computePromptFrameLogViewportHeight(termRows, paneHeight, promptFrame),
  };
}
