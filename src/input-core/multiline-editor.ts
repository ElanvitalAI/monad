export interface MultilineEditorState {
  lines: string[];
  line: number;
  col: number;
}

export function multilineEditorInsertLineBreak(
  state: MultilineEditorState,
): MultilineEditorState {
  const lines = state.lines.slice();
  const current = lines[state.line] ?? '';
  const before = current.slice(0, state.col);
  const after = current.slice(state.col);
  lines[state.line] = before;
  lines.splice(state.line + 1, 0, after);
  return {
    lines,
    line: state.line + 1,
    col: 0,
  };
}

export function multilineEditorBackspace(
  state: MultilineEditorState,
): MultilineEditorState {
  const lines = state.lines.slice();
  const current = lines[state.line] ?? '';
  if (state.col > 0) {
    lines[state.line] = current.slice(0, state.col - 1) + current.slice(state.col);
    return { lines, line: state.line, col: state.col - 1 };
  }
  if (state.line > 0) {
    const prev = lines[state.line - 1] ?? '';
    const prevLen = prev.length;
    lines[state.line - 1] = prev + current;
    lines.splice(state.line, 1);
    return {
      lines,
      line: state.line - 1,
      col: prevLen,
    };
  }
  return state;
}

export function multilineEditorMoveLeft(
  state: MultilineEditorState,
): MultilineEditorState {
  if (state.col > 0) return { ...state, col: state.col - 1 };
  if (state.line > 0) {
    return {
      ...state,
      line: state.line - 1,
      col: (state.lines[state.line - 1] ?? '').length,
    };
  }
  return state;
}

export function multilineEditorMoveRight(
  state: MultilineEditorState,
): MultilineEditorState {
  const current = state.lines[state.line] ?? '';
  if (state.col < current.length) return { ...state, col: state.col + 1 };
  if (state.line < state.lines.length - 1) {
    return {
      ...state,
      line: state.line + 1,
      col: 0,
    };
  }
  return state;
}

export function multilineEditorMoveVertical(
  state: MultilineEditorState,
  dir: -1 | 1,
): MultilineEditorState {
  const nextLine = Math.max(0, Math.min(state.lines.length - 1, state.line + dir));
  return {
    ...state,
    line: nextLine,
    col: Math.min(state.col, (state.lines[nextLine] ?? '').length),
  };
}
