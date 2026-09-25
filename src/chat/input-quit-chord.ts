import type { Key } from '../tui.js';

export function isTextInputQuitChord(key: Key): boolean {
  if (!key.ctrl) return false;
  if (key.name === '\\' || key.name === 'backslash') return true;
  if (key.name === 'q' || key.name === 'Q' || key.name === 'ㅂ' || key.name === 'ㅃ') return true;
  return false;
}
