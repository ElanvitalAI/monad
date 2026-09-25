import type { KeyEvent } from '../plugins/core/types.js';
import {
  inlineEditorBackspace,
  inlineEditorClear,
  inlineEditorCutToEnd,
  inlineEditorDelete,
  inlineEditorDeleteWordBackward,
  inlineEditorInsert,
  inlineEditorMoveEnd,
  inlineEditorMoveHome,
  inlineEditorMoveLeft,
  inlineEditorMoveRight,
  inlineEditorSeekWordBoundary,
  type InlineEditorState,
} from './inline-editor.js';
import { keyEventToTextInsertion } from './text-entry.js';

export interface ApplyInlineEditorKeyOpts {
  shiftEnter?: 'newline' | 'ignore';
  tab?: string | null;
}

export function applyInlineEditorKey(
  state: InlineEditorState,
  ev: KeyEvent,
  opts: ApplyInlineEditorKeyOpts = {},
): InlineEditorState | null {
  const name = (ev.name ?? '').toLowerCase();
  if ((name === 'enter' || name === 'return') && ev.shift && opts.shiftEnter === 'newline') {
    return inlineEditorInsert(state, '\n');
  }
  if (name === 'backspace') return inlineEditorBackspace(state);
  if (name === 'delete') return inlineEditorDelete(state);
  if (name === 'left') {
    if (ev.ctrl) return { text: state.text, cursor: inlineEditorSeekWordBoundary(state.text, state.cursor, -1) };
    return inlineEditorMoveLeft(state);
  }
  if (name === 'right') {
    if (ev.ctrl) return { text: state.text, cursor: inlineEditorSeekWordBoundary(state.text, state.cursor, 1) };
    return inlineEditorMoveRight(state);
  }
  if (name === 'home') return inlineEditorMoveHome(state);
  if (name === 'end') return inlineEditorMoveEnd(state);
  if (ev.ctrl && name === 'a') return inlineEditorMoveHome(state);
  if (ev.ctrl && name === 'e') return inlineEditorMoveEnd(state);
  if (ev.ctrl && name === 'k') return inlineEditorCutToEnd(state);
  if (ev.ctrl && name === 'w') return inlineEditorDeleteWordBackward(state);
  if (ev.ctrl && name === 'u') return inlineEditorClear(state);
  const inserted = keyEventToTextInsertion(ev, { tab: opts.tab });
  if (inserted !== null) return inlineEditorInsert(state, inserted);
  return null;
}
