import type { PromptFrame } from './prompt-frame.js';

export interface PromptFramePaintRow {
  row: number;
  text: string;
}

export function buildPromptFramePlaceholderRows(
  frame: PromptFrame,
  promptLine: string,
  height: number = frame.inputHeight,
): string[] {
  const rows: string[] = [];
  const clampedHeight = Math.max(0, height);
  for (let i = 0; i < clampedHeight; i++) {
    rows.push(i === clampedHeight - 1 ? promptLine : '');
  }
  return rows;
}

export function buildPromptFrameDividerRows(
  frame: PromptFrame,
  dividerLine: string,
): PromptFramePaintRow[] {
  const rows: PromptFramePaintRow[] = [];
  if (frame.topDividerRow >= 1) rows.push({ row: frame.topDividerRow, text: dividerLine });
  if (frame.bottomDividerRow >= 1) rows.push({ row: frame.bottomDividerRow, text: dividerLine });
  return rows;
}
