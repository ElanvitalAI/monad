import type { Key } from '../tui.js';

const DEFAULT_BLOCKED_NAMES = new Set([
  'paste-start',
  'paste-end',
  'mouse',
  'pageup',
  'pagedown',
  'escape',
  'left',
  'right',
  'up',
  'down',
  'home',
  'end',
  '',
]);

export interface SimpleTextKeySpec {
  allowSpace?: boolean;
  allowPattern?: RegExp;
  blockedNames?: ReadonlySet<string>;
}

export function backspaceInputText(value: string): string {
  return value.slice(0, -1);
}

export function appendInputText(
  value: string,
  addition: string,
  maxLength?: number,
): string {
  if (maxLength !== undefined && value.length >= maxLength) return value;
  const next = value + addition;
  return maxLength !== undefined ? next.slice(0, maxLength) : next;
}

export function textFromInputKey(
  key: Pick<Key, 'name' | 'ctrl' | 'alt'>,
  spec: SimpleTextKeySpec = {},
): string | null {
  if (key.ctrl || key.alt) return null;
  if (key.name === 'space') return spec.allowSpace ? ' ' : null;
  if ((spec.blockedNames ?? DEFAULT_BLOCKED_NAMES).has(key.name)) return null;
  if (key.name.length < 1 || key.name.startsWith('\x1b')) return null;
  if (spec.allowPattern && !spec.allowPattern.test(key.name)) return null;
  return key.name;
}
