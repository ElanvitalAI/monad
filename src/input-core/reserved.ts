// Reserved keys + action IDs.
//
// These keys and action IDs CANNOT be rebound from user-config or
// LLM SetInputBinding — they're the user's escape hatches and the
// app's self-preservation primitives. A typo'd custom binding must
// never be able to wedge them.
//
// R11 — reservation is context-aware. Some keys (Ctrl+C / Ctrl+Q /
// Ctrl+D) are sacred everywhere. Others (Enter / Escape) are
// reserved only where they have a canonical meaning (modal submit /
// cancel) and legitimately overridable elsewhere (Enter as newline
// in the input textarea). A binding with NO context is treated as
// "fires everywhere" and therefore must clear the strictest
// (global) reserved set.

import type { ContextTag } from './context.js';

/** Keys that are ALWAYS reserved regardless of context tag. The
 *  user must have an unconditional way to interrupt / quit / EOF. */
const ALWAYS_RESERVED_KEYS: ReadonlySet<string> = new Set([
  'ctrl+c',   // interrupt current operation
  'ctrl+q',   // quit application
  'ctrl+d',   // EOF on empty input line
]);

/** Context-specific reserved sets. Any context NOT listed inherits
 *  ALWAYS_RESERVED_KEYS. `global` is the superset — binding without
 *  a `context` tag fires everywhere, so it has to pass the widest
 *  filter. */
const CONTEXT_RESERVED_KEYS: Partial<Record<ContextTag, ReadonlySet<string>>> = {
  global: new Set([...ALWAYS_RESERVED_KEYS, 'escape', 'enter']),
  input: new Set([...ALWAYS_RESERVED_KEYS]),   // Enter=newline, Esc=cancel-input — legitimate rebinds
  modal: new Set([...ALWAYS_RESERVED_KEYS, 'escape', 'enter']),
  'search-modal': new Set([...ALWAYS_RESERVED_KEYS, 'escape', 'enter']),
  'approval-modal': new Set([...ALWAYS_RESERVED_KEYS, 'escape', 'enter']),
  'plan-mode': new Set([...ALWAYS_RESERVED_KEYS, 'escape']),
  popup: new Set([...ALWAYS_RESERVED_KEYS, 'escape', 'enter']),
  'terminal-modal': new Set([...ALWAYS_RESERVED_KEYS]),   // PTY owns keys; only hard interrupts stay
};

/** Resolve the effective reserved-key set for a binding scope.
 *  Omitted context = global (strictest). */
export function reservedKeysForContext(context?: ContextTag): ReadonlySet<string> {
  if (!context) return CONTEXT_RESERVED_KEYS.global!;
  return CONTEXT_RESERVED_KEYS[context] ?? ALWAYS_RESERVED_KEYS;
}

/** Back-compat export. Equals the strictest (`global`) reserved set
 *  so callers unaware of context get the conservative filter. Docs /
 *  SPEC / help popup may still enumerate this. */
export const RESERVED_KEYS: ReadonlySet<string> = CONTEXT_RESERVED_KEYS.global!;

/** Action IDs that cannot be rebound or replaced via SetInputBinding.
 *  Users can still ADD bindings that trigger these actions (e.g. a
 *  second interrupt key) — they just can't UN-bind the defaults. */
export const RESERVED_ACTION_IDS: ReadonlySet<string> = new Set([
  'app.interrupt',
  'app.quit',
  'modal.cancel',
  'modal.submit',
]);

/** Back-compat: boolean "is this key reserved in ANY context?" —
 *  same as checking against RESERVED_KEYS (global union). Callers
 *  that know their scope should prefer `reservedKeysForContext`. */
export function isReservedKey(matcher: string): boolean {
  return RESERVED_KEYS.has(matcher.toLowerCase());
}

export function isReservedActionId(actionId: string): boolean {
  return RESERVED_ACTION_IDS.has(actionId);
}

/** Reason object returned when a reservation check fails — shaped so
 *  LLM tool responses and audit-log entries can both consume it. */
export interface ReservationViolation {
  kind: 'reserved-key' | 'reserved-action';
  /** The offending matcher or actionId. */
  value: string;
  /** Human-readable hint for the caller. */
  message: string;
  /** Context used for the check — 'global' when caller did not
   *  specify. Useful for "why is this reserved here but not there?"
   *  explanations. */
  context: ContextTag | 'global';
}

/** Validate a rebind request. Returns null when the request is safe,
 *  or a structured violation for the first problem found. `context`
 *  is the context scope the binding WILL be installed under — pass
 *  `undefined` for a global binding (strictest check). */
export function validateRebind(
  actionId: string,
  keys: readonly string[],
  context?: ContextTag,
): ReservationViolation | null {
  if (isReservedActionId(actionId)) {
    return {
      kind: 'reserved-action',
      value: actionId,
      message: `Action "${actionId}" is reserved and cannot be rebound.`,
      context: context ?? 'global',
    };
  }
  const reserved = reservedKeysForContext(context);
  for (const k of keys) {
    if (reserved.has(k.toLowerCase())) {
      const scope = context ?? 'global';
      return {
        kind: 'reserved-key',
        value: k,
        message: `Key "${k}" is reserved in context "${scope}" and cannot be bound to a user action there.`,
        context: scope,
      };
    }
  }
  return null;
}
