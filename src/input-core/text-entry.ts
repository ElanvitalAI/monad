import type { KeyEvent } from '../plugins/core/types.js';

const NON_TEXT_KEY_NAMES = new Set([
  '',
  'backspace',
  'delete',
  'enter',
  'return',
  'escape',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'mouse',
  'paste-start',
  'paste-end',
]);

export interface KeyEventTextInsertionOpts {
  readonly tab?: string | null;
}

/** Shared mini-input text insertion rule for non-terminal-owned
 *  composers. Mirrors chat-main's semantics for space + multi-byte
 *  text while keeping control/navigation keys out of the buffer. */
export function keyEventToTextInsertion(
  ev: KeyEvent,
  opts: KeyEventTextInsertionOpts = {},
): string | null {
  const name = ev.name ?? '';
  if (ev.ctrl || ev.alt) return null;
  if (name === 'space') return ' ';
  if (name === 'tab') return opts.tab ?? null;
  if (name.startsWith('\x1b')) return null;
  if (NON_TEXT_KEY_NAMES.has(name)) return null;
  return preservePrintableText(ev, name);
}

function preservePrintableText(ev: KeyEvent, name: string): string {
  if (
    ev.sequence
    && ev.sequence.length === 1
    && name.length === 1
    && ev.sequence !== name
    && ev.sequence.toLowerCase() === name.toLowerCase()
  ) {
    return ev.sequence;
  }
  if (name.length === 1) return ev.shift ? name.toUpperCase() : name;
  return name;
}
