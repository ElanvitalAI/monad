import type { InlineEditorState } from '../input-core/inline-editor.js';
import type { MultilineEditorState } from '../input-core/multiline-editor.js';

export interface TextInputBufferState {
  lines: string[];
  lineIdx: number;
  colIdx: number;
}

export function currentLineEditorState(state: TextInputBufferState): InlineEditorState {
  return {
    text: state.lines[state.lineIdx] ?? '',
    cursor: state.colIdx,
  };
}

export function applyCurrentLineEditorState(
  state: TextInputBufferState,
  next: InlineEditorState,
): TextInputBufferState {
  const lines = state.lines.slice();
  lines[state.lineIdx] = next.text;
  return {
    lines,
    lineIdx: state.lineIdx,
    colIdx: next.cursor,
  };
}

export function multilineEditorState(state: TextInputBufferState): MultilineEditorState {
  return {
    lines: state.lines.slice(),
    line: state.lineIdx,
    col: state.colIdx,
  };
}

export function applyMultilineEditorState(
  next: MultilineEditorState,
): TextInputBufferState {
  return {
    lines: next.lines,
    lineIdx: next.line,
    colIdx: next.col,
  };
}

export function insertTextAtCursor(
  state: TextInputBufferState,
  text: string,
): TextInputBufferState {
  if (!text) return state;
  const line = state.lines[state.lineIdx] ?? '';
  const lines = state.lines.slice();
  lines[state.lineIdx] = line.slice(0, state.colIdx) + text + line.slice(state.colIdx);
  return {
    lines,
    lineIdx: state.lineIdx,
    colIdx: state.colIdx + text.length,
  };
}

/** Insert text that may contain line breaks without synthesizing input keys. */
export function insertMultilineTextAtCursor(
  state: TextInputBufferState,
  text: string,
): TextInputBufferState {
  if (!text) return state;
  const line = state.lines[state.lineIdx] ?? '';
  const before = line.slice(0, state.colIdx);
  const after = line.slice(state.colIdx);
  const chunks = text.split('\n');
  const lines = state.lines.slice();
  const insertedLines = chunks.map((chunk, index) => {
    if (chunks.length === 1) return before + chunk + after;
    if (index === 0) return before + chunk;
    if (index === chunks.length - 1) return chunk + after;
    return chunk;
  });
  lines.splice(state.lineIdx, 1, ...insertedLines);
  return {
    lines,
    lineIdx: state.lineIdx + insertedLines.length - 1,
    colIdx: chunks.length === 1 ? before.length + chunks[0]!.length : chunks[chunks.length - 1]!.length,
  };
}
