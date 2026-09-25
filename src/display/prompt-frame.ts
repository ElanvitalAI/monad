import { visibleWidth } from '../tui.js';

export interface PromptFrame {
  inputHeight: number;
  promptTopRow: number;
  promptBottomRow: number;
  topDividerRow: number;
  bottomDividerRow: number;
}

export function clampPromptInputHeight(visibleLines: number, maxLines = 8): number {
  return Math.max(1, Math.min(visibleLines, maxLines));
}

/**
 * Compute the topmost visible line index (`firstVisibleIdx`) for a
 * scrolling text-input window. The buffer may contain more lines than
 * the window can show; this picks a window that always contains the
 * cursor's line. Cursor pins to the bottom row when at/near the end of
 * the buffer; otherwise the window shifts up just enough to keep
 * `lineIdx` visible.
 *
 * Without this clamp, multi-line pastes whose line count exceeded
 * `maxLines` left the bottom rows rendered nowhere, while the cursor
 * was clamped to the last visible row — making backspace look broken
 * because edits happened on an off-screen line.
 */
export function firstVisibleInputLineIdx(
  numLines: number,
  visibleLines: number,
  lineIdx: number,
): number {
  return Math.max(
    0,
    Math.min(numLines - visibleLines, lineIdx - visibleLines + 1),
  );
}

export interface InputLineWindow {
  display: string;
  cursorCol: number;
}

function codePointBoundaries(text: string): number[] {
  const boundaries = [0];
  for (let index = 0; index < text.length;) {
    index += text.codePointAt(index)! > 0xFFFF ? 2 : 1;
    boundaries.push(index);
  }
  return boundaries;
}

/**
 * Select the one-line display window that contains the input caret.
 * Windows move only at Unicode code-point boundaries, keeping surrogate
 * pairs intact while `visibleWidth` supplies the terminal-column geometry.
 */
export function inputLineWindow(text: string, cursor: number, width: number): InputLineWindow {
  const safeWidth = Math.max(0, width);
  const boundaries = codePointBoundaries(text);
  const requestedCursor = Math.max(0, Math.min(cursor, text.length));
  let cursorIndex = boundaries.length - 1;
  while (cursorIndex > 0 && boundaries[cursorIndex]! > requestedCursor) {
    cursorIndex--;
  }
  const cursorBoundary = boundaries[cursorIndex]!;

  if (visibleWidth(text) <= safeWidth) {
    return { display: text, cursorCol: visibleWidth(text.slice(0, cursorBoundary)) };
  }

  if (cursorBoundary === text.length) {
    let startIndex = boundaries.length - 1;
    while (startIndex > 0 && visibleWidth(text.slice(boundaries[startIndex - 1]!)) <= safeWidth) {
      startIndex--;
    }
    const display = text.slice(boundaries[startIndex]!);
    return { display, cursorCol: visibleWidth(display) };
  }

  let endIndex = cursorIndex;
  while (endIndex < boundaries.length - 1 && visibleWidth(text.slice(cursorBoundary, boundaries[endIndex + 1]!)) <= safeWidth) {
    endIndex++;
  }
  return {
    display: text.slice(cursorBoundary, boundaries[endIndex]!),
    cursorCol: 0,
  };
}

export function bottomFixedRowsForPromptFrame(inputHeight: number): number {
  return 1 + inputHeight + 1 + 2 + 1 + 1 + 1;
}

export function buildPromptFrameFromPromptBottomRow(
  promptBottomRow: number,
  visibleLines: number,
  maxLines = 8,
): PromptFrame {
  const inputHeight = clampPromptInputHeight(visibleLines, maxLines);
  const promptTopRow = promptBottomRow - inputHeight + 1;
  return {
    inputHeight,
    promptTopRow,
    promptBottomRow,
    topDividerRow: promptTopRow - 1,
    bottomDividerRow: promptBottomRow + 1,
  };
}

export function fallbackPromptFrame(
  termRows: number,
  visibleLines: number,
  maxLines = 8,
): PromptFrame {
  return buildPromptFrameFromPromptBottomRow(Math.max(2, termRows - 6), visibleLines, maxLines);
}

export function resolvePromptFrame(
  termRows: number,
  visibleLines: number,
  zoneRows?: ReadonlyMap<string, { start: number; height: number }>,
  maxLines = 8,
): PromptFrame {
  const inputZone = zoneRows?.get('input-prompt');
  if (inputZone && inputZone.height > 0) {
    return buildPromptFrameFromPromptBottomRow(
      inputZone.start + inputZone.height - 1,
      inputZone.height,
      maxLines,
    );
  }
  return fallbackPromptFrame(termRows, visibleLines, maxLines);
}
