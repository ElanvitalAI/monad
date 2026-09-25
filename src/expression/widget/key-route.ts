// Pure key-routing for the interactive modal widget.
//
// Hosts pump key events here as `(state, key) -> action`. The
// returned action is one of a small set the session recognizes;
// dispatching the action is the host's job. Keeping this pure means
// the hot routing path is unit-testable without spinning up readline
// / TTY / dashboard.
//
// The convention mirrors `preview-terminal-key-route.ts` (popup
// terminal polish, PR #784-#788) — each modal owns a distinct
// pure routing fn so cross-widget interference is structurally
// blocked.

import type { ModalSessionState } from './state-machine.js';

export interface ModalKey {
  /** Symbolic key name (e.g. 'enter', 'escape', 'tab', 'up', 'down',
   *  'left', 'right', 'backspace') or a single printable char. */
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type ModalKeyAction =
  | { kind: 'submit' }
  | { kind: 'cancel' }
  | { kind: 'navigate'; direction: 'prev' | 'next' }
  | { kind: 'edit'; char: string }
  | { kind: 'erase' }
  | { kind: 'passthrough' };

/** Decide what to do with a key for the current state. The widget
 *  swallows submission / cancellation / navigation; printable
 *  characters become `edit` actions; anything else is `passthrough`
 *  so the host can let the underlying surface handle it. */
export function routeInteractiveModalKey(
  state: ModalSessionState,
  key: ModalKey,
): ModalKeyAction {
  // Cancel — Esc + Ctrl-C universally, regardless of state. This is
  // the same convention as the popup terminal: bail-out keys never
  // land on the underlying surface.
  if (key.name === 'escape') return { kind: 'cancel' };
  if (key.name === 'c' && key.ctrl) return { kind: 'cancel' };

  // Done / cancel are absorbing — nothing to route.
  if (state === 'done' || state === 'cancel') return { kind: 'passthrough' };

  // Awaiting input.
  if (state === 'awaiting' || state === 'show') {
    if (key.name === 'enter' || key.name === 'return') return { kind: 'submit' };
    if (key.name === 'tab') {
      return { kind: 'navigate', direction: key.shift ? 'prev' : 'next' };
    }
    if (key.name === 'up') return { kind: 'navigate', direction: 'prev' };
    if (key.name === 'down') return { kind: 'navigate', direction: 'next' };
    if (key.name === 'backspace') return { kind: 'erase' };
    if (isPrintable(key)) return { kind: 'edit', char: key.name };
  }

  // Answered / chained — only submit / cancel apply; navigation
  // until the next step's `show`.
  if (state === 'answered' || state === 'chained') {
    if (key.name === 'enter' || key.name === 'return') return { kind: 'submit' };
  }

  return { kind: 'passthrough' };
}

function isPrintable(key: ModalKey): boolean {
  if (key.ctrl || key.meta) return false;
  if (typeof key.name !== 'string' || key.name.length !== 1) return false;
  const code = key.name.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}
