import { debug } from '../debug/log.js';

const PTY_SPECIAL_KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  delete: '\x1b[3~',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
} as const;

const PTY_SPECIAL_KEY_ALIASES = {
  escape: 'esc',
} as const;

/** `ctrl+a` through `ctrl+z` are ASCII control bytes 0x01 through 0x1a.
 *  Accept `control+c` and terminal-style `^c` as equivalent spellings. */
function resolveControlKey(normalized: string): string | undefined {
  const letter = /^(?:ctrl\+|control\+|\^)([a-z])$/.exec(normalized)?.[1];
  return letter ? String.fromCharCode(letter.charCodeAt(0) - 96) : undefined;
}

type PtySpecialKey = keyof typeof PTY_SPECIAL_KEYS;
type PtySpecialKeyAlias = keyof typeof PTY_SPECIAL_KEY_ALIASES;

export function resolvePtySpecialKey(name: string): string {
  const normalized = name.trim().toLowerCase();
  const controlBytes = resolveControlKey(normalized);
  if (controlBytes) {
    debug.log('pty.special-key', 'resolved', { inputName: name, resolvedName: normalized, control: true });
    return controlBytes;
  }
  const alias = PTY_SPECIAL_KEY_ALIASES[normalized as PtySpecialKeyAlias];
  const resolvedName = alias ?? normalized;
  const bytes = PTY_SPECIAL_KEYS[resolvedName as PtySpecialKey];
  if (!bytes) {
    throw new Error(`unknown PTY special key: ${name}; available names: ${[...Object.keys(PTY_SPECIAL_KEYS), ...Object.keys(PTY_SPECIAL_KEY_ALIASES), 'ctrl+a..ctrl+z'].join(', ')}`);
  }
  debug.log('pty.special-key', 'resolved', { inputName: name, resolvedName, alias: alias !== undefined });
  return bytes;
}
