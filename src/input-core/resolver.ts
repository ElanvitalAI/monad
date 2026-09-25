// Policy resolver — maps InputEvent + context stack → action id.
//
// O(1) on the hot path: matcher-cascade lookup in a hash-map (VSCode
// `KeybindingResolver`-style). Context gating is a linear scan through
// the stack — short (< ~5 entries) so the total cost is negligible.
//
// No chord support in this pass. Chord ownership lives in the
// existing src/chord.ts module; Phase 5 (deferred) wires the chord
// machine into the resolver's arming state. For Phase 2 the resolver
// is single-key only — good enough for the pilot binding and for
// Phase 3's mouse events.

import { matcherCascade, type InputEvent } from './event.js';
import { lookupBindings, type Binding } from './bindings.js';
import { currentContext } from './context.js';
import { getAction } from './actions.js';
import { consumeChordContinuation, isChordArmed } from './chord-state.js';
import { evaluateWhenClause, type WhenClauseContext } from './when-clause.js';

export interface ResolveResult {
  actionId: string;
  matcher: string;
  /** Which layer the winning binding came from. */
  source: 'default' | 'user-config' | 'runtime';
}

/** IDX-2a — dependencies the resolver can accept to enable when-clause
 *  gating. If `getContextKeys` is absent (or returns null), bindings
 *  with a `when` field are SKIPPED (fail-closed) — better than silently
 *  ignoring the guard. A parse error on a when-clause is reported via
 *  the optional onWhenClauseError hook and the binding is skipped. */
export interface ResolverDeps {
  getContextKeys?: () => WhenClauseContext | null;
  onWhenClauseError?: (binding: Binding, message: string) => void;
}

/** Check if a binding passes its when-clause gate. Pure predicate —
 *  returns true for bindings without `when` (backward compat). */
function whenClauseAllows(b: Binding, deps: ResolverDeps | undefined): boolean {
  if (!b.when) return true;
  const ctx = deps?.getContextKeys?.();
  if (!ctx) return false;   // fail-closed when no context keys available
  const result = evaluateWhenClause(b.when, ctx);
  if (result.ok === false) {
    deps?.onWhenClauseError?.(b, result.error.message);
    return false;
  }
  return result.value;
}

/** Resolve an event to the action id that should fire. Returns null
 *  when no binding matches the event in the current context.
 *
 *  Phase 5 — when a chord leader is armed, the FIRST matcher tried
 *  is the combined `<leader> <continuation>` form. On miss the
 *  resolver falls back to the normal matcher cascade so the
 *  continuation letter doesn't vanish into the ether when the user
 *  armed a chord but then pressed an unbound second key. */
export function resolveInputEvent(ev: InputEvent, deps?: ResolverDeps): ResolveResult | null {
  const stack = currentContext();

  // Chord path: if a leader is armed, treat `ev` as the continuation
  // and try the combined matcher first. consumeChord disarms the
  // state whether or not we find a binding — a stray letter after
  // Ctrl+B shouldn't leave the chord armed for the NEXT keystroke.
  if (isChordArmed() && ev.kind === 'key') {
    const continuationMatcher = matcherCascade(ev)[0]!;
    const combined = consumeChordContinuation(continuationMatcher);
    if (combined) {
      const bindings = lookupBindings(combined);
      for (const b of bindings) {
        if (b.context !== undefined && !stack.includes(b.context)) continue;
        if (!whenClauseAllows(b, deps)) continue;
        return { actionId: b.actionId, matcher: combined, source: b.source };
      }
    }
  }

  const candidates = matcherCascade(ev);
  // Walk specific → generic. First match wins.
  for (const matcher of candidates) {
    const bindings = lookupBindings(matcher);
    if (bindings.length === 0) continue;
    // Filter by context: contextless bindings always match; contextful
    // bindings must name a tag present in the current stack.
    for (const b of bindings) {
      if (b.context !== undefined && !stack.includes(b.context)) continue;
      if (!whenClauseAllows(b, deps)) continue;
      return { actionId: b.actionId, matcher, source: b.source };
    }
  }
  return null;
}

/** Convenience: resolve + invoke the action. Returns `true` when an
 *  action fired, `false` when no binding matched. Exceptions from the
 *  handler are caught and re-thrown after logging via the optional
 *  errorSink. */
export async function dispatchInputEvent(
  ev: InputEvent,
  errorSink?: (err: unknown, actionId: string) => void,
  deps?: ResolverDeps,
): Promise<boolean> {
  const r = resolveInputEvent(ev, deps);
  if (!r) return false;
  const action = getAction(r.actionId);
  if (!action) return false;   // binding refers to unknown action
  try {
    await action.handler();
    return true;
  } catch (err) {
    errorSink?.(err, r.actionId);
    throw err;
  }
}
