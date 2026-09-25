import type { Key } from '../tui.js';

export type TextInputEditAction =
  | { kind: 'none' }
  | { kind: 'backspace' }
  | { kind: 'move-left' }
  | { kind: 'move-right' }
  | { kind: 'history-older' }
  | { kind: 'history-newer' }
  | { kind: 'move-vertical'; delta: -1 | 1 }
  | { kind: 'move-home' }
  | { kind: 'move-end' }
  | { kind: 'kill-before-cursor' }
  | { kind: 'kill-after-cursor' };

export interface TextInputEditState {
  linesLength: number;
  lineIdx: number;
  historyLength: number;
  historyIdx: number;
}

export function resolveTextInputEditAction(
  key: Pick<Key, 'name' | 'ctrl'>,
  state: TextInputEditState,
): TextInputEditAction {
  if (key.name === 'backspace') {
    return { kind: 'backspace' };
  }
  if (key.name === 'left') {
    return { kind: 'move-left' };
  }
  if (key.name === 'right') {
    return { kind: 'move-right' };
  }
  if (key.name === 'up') {
    if (state.linesLength === 1 && state.historyLength > 0 && state.historyIdx < state.historyLength - 1) {
      return { kind: 'history-older' };
    }
    if (state.lineIdx > 0) {
      return { kind: 'move-vertical', delta: -1 };
    }
    return { kind: 'none' };
  }
  if (key.name === 'down') {
    if (state.linesLength === 1 && state.historyIdx >= 0) {
      return { kind: 'history-newer' };
    }
    if (state.lineIdx < state.linesLength - 1) {
      return { kind: 'move-vertical', delta: 1 };
    }
    return { kind: 'none' };
  }
  if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
    return { kind: 'move-home' };
  }
  if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
    return { kind: 'move-end' };
  }
  if (key.ctrl && key.name === 'u') {
    return { kind: 'kill-before-cursor' };
  }
  if (key.ctrl && key.name === 'k') {
    return { kind: 'kill-after-cursor' };
  }
  return { kind: 'none' };
}
