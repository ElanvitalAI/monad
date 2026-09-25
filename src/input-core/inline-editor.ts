export interface InlineEditorState {
  text: string;
  cursor: number;
}

export function createInlineEditorState(text = ''): InlineEditorState {
  return {
    text,
    cursor: text.length,
  };
}

export function inlineEditorInsert(
  state: InlineEditorState,
  inserted: string,
): InlineEditorState {
  if (!inserted) return state;
  return {
    text: state.text.slice(0, state.cursor) + inserted + state.text.slice(state.cursor),
    cursor: state.cursor + inserted.length,
  };
}

export function inlineEditorBackspace(state: InlineEditorState): InlineEditorState {
  if (state.cursor <= 0) return state;
  return {
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  };
}

export function inlineEditorDelete(state: InlineEditorState): InlineEditorState {
  if (state.cursor >= state.text.length) return state;
  return {
    text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1),
    cursor: state.cursor,
  };
}

export function inlineEditorMoveLeft(state: InlineEditorState): InlineEditorState {
  return { text: state.text, cursor: Math.max(0, state.cursor - 1) };
}

export function inlineEditorMoveRight(state: InlineEditorState): InlineEditorState {
  return { text: state.text, cursor: Math.min(state.text.length, state.cursor + 1) };
}

export function inlineEditorMoveHome(state: InlineEditorState): InlineEditorState {
  return { text: state.text, cursor: 0 };
}

export function inlineEditorMoveEnd(state: InlineEditorState): InlineEditorState {
  return { text: state.text, cursor: state.text.length };
}

export function inlineEditorClear(state: InlineEditorState): InlineEditorState {
  if (!state.text && state.cursor === 0) return state;
  return { text: '', cursor: 0 };
}

export function inlineEditorCutToEnd(state: InlineEditorState): InlineEditorState {
  if (state.cursor >= state.text.length) return state;
  return { text: state.text.slice(0, state.cursor), cursor: state.cursor };
}

export function inlineEditorDeleteWordBackward(state: InlineEditorState): InlineEditorState {
  const next = inlineEditorSeekWordBoundary(state.text, state.cursor, -1);
  if (next === state.cursor) return state;
  return {
    text: state.text.slice(0, next) + state.text.slice(state.cursor),
    cursor: next,
  };
}

export function inlineEditorSeekWordBoundary(
  text: string,
  from: number,
  dir: -1 | 1,
): number {
  if (dir === -1) {
    let i = Math.max(0, from);
    while (i > 0 && /\s/.test(text[i - 1] ?? '')) i--;
    while (i > 0 && !/\s/.test(text[i - 1] ?? '')) i--;
    return i;
  }
  let i = Math.min(text.length, from);
  while (i < text.length && !/\s/.test(text[i] ?? '')) i++;
  while (i < text.length && /\s/.test(text[i] ?? '')) i++;
  return i;
}
