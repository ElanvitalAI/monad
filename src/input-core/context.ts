// Context stack — tagged enum replacement for VSCode-style when-clause
// expressions. Each binding may name one or more contexts; the
// resolver walks the stack top-down and a binding matches when its
// context is NOT excluded by the current top OR when the binding is
// context-less (global).
//
// Why tagged enum over string expressions: see
// ~/.claude/plans/snuggly-floating-dawn.md §"Reference
// Synthesis" under "Avoid" — VSCode's `contextkey.ts` parses and
// evaluates arbitrary boolean expressions per keystroke (slow,
// silent-typo-fails, hard to debug). Zed's tag stack is faster,
// type-safe, and adequate for our needs.

export type ContextTag =
  | 'global'
  | 'input'          // chat input textarea
  | 'pane-browse'    // pane focus (NOT input)
  | 'modal'          // any centered / transient modal
  | 'search-modal'   // agent search modal specifically
  | 'approval-modal' // HITL / approval flow
  | 'plan-mode'      // plan session active
  | 'control-mode'   // control mode active (Phase 4)
  | 'terminal-modal' // interactive terminal overlay
  | 'virtual-window' // VW foreground surface
  | 'popup';         // pill popup / select popup

/** Immutable snapshot of the current context stack, topmost first. */
export type ContextStack = readonly ContextTag[];

const _stack: ContextTag[] = ['global'];

export function pushContext(tag: ContextTag): void {
  _stack.push(tag);
}

export function popContext(tag: ContextTag): void {
  // Pop only when the top matches — defensive against double-exit.
  for (let i = _stack.length - 1; i >= 0; i--) {
    if (_stack[i] === tag) {
      _stack.splice(i, 1);
      return;
    }
  }
}

export function replaceContext(remove: ContextTag, add: ContextTag): void {
  for (let i = _stack.length - 1; i >= 0; i--) {
    if (_stack[i] === remove) {
      _stack[i] = add;
      return;
    }
  }
  _stack.push(add);
}

export function currentContext(): ContextStack {
  return [..._stack].reverse() as ContextStack;
}

/** Test helper — restore the default stack between scenarios. */
export function __resetContextForTests(): void {
  _stack.length = 0;
  _stack.push('global');
}
