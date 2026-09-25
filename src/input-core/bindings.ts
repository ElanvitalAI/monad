// Binding table — maps matcher strings to action IDs, optionally
// scoped to a ContextTag stack.
//
// Three-layer overlay:
//   1. Defaults     — hard-coded in this module (baseline that ships
//                     with every monad install).
//   2. User-config  — TODO Phase 7: loaded from user-config's
//                     inputBindings field. Overrides defaults.
//   3. Runtime      — set by LLM via SetInputBinding. Highest priority.
//                     Lost on restart unless persisted.
//
// Each matcher can map to multiple bindings with different contexts.
// The resolver walks the current ContextStack top-down and picks the
// most-specific match.

import type { ContextTag } from './context.js';
import { validateRebind } from './reserved.js';

export interface Binding {
  matcher: string;        // canonical form from toMatcher()
  actionId: string;
  /** When set, the binding only fires while the tag is somewhere in
   *  the active stack. Omit for a global binding. */
  context?: ContextTag;
  /** IDX-2a — optional VSCode-style when-clause evaluated against the
   *  ContextKeyService snapshot (see src/input-core/when-clause.ts).
   *  Binding is skipped if expression evaluates to false. If the
   *  expression is malformed or the resolver has no context-key
   *  service wired, the binding is SKIPPED (fail-closed) so a broken
   *  when-clause never escalates keys to the underlying binding. */
  when?: string;
  /** Source of the binding — used by GetInputPolicy + /keys so the
   *  user can see where a binding came from. */
  source: 'default' | 'user-config' | 'runtime';
}

export type BindingLayer = 'default' | 'user-config' | 'runtime';

interface LayerState {
  defaults: Map<string, Binding[]>;
  userConfig: Map<string, Binding[]>;
  runtime: Map<string, Binding[]>;
}

const state: LayerState = {
  defaults: new Map(),
  userConfig: new Map(),
  runtime: new Map(),
};

/** Install default bindings. Called at bootstrap; callers may invoke
 *  multiple times (e.g. plugin-contributed defaults). Silent overwrite
 *  of an existing default is allowed — the last-writer wins within
 *  a layer. */
export function addDefaultBinding(b: Omit<Binding, 'source'>): void {
  addToLayer(state.defaults, { ...b, source: 'default' });
}

/** Replace the user-config layer with a fresh set. Called after a
 *  config-file reload. */
export function setUserConfigBindings(bindings: Omit<Binding, 'source'>[]): void {
  state.userConfig.clear();
  for (const b of bindings) {
    addToLayer(state.userConfig, { ...b, source: 'user-config' });
  }
}

/** Add or replace a runtime binding (LLM-driven or interactive /rebind).
 *  Returns null on success or a ReservationViolation when the rebind
 *  is rejected. IDX-2a — optional `when` is stored verbatim; parse
 *  errors surface at resolve time (fail-closed). */
export function setRuntimeBinding(
  actionId: string,
  matchers: string[],
  context?: ContextTag,
  when?: string,
): ReturnType<typeof validateRebind> {
  // R11 — pass context so reserved-key check matches the intended
  // scope. Binding with no context = global scope = strictest
  // reserved filter. Context-specific bindings (e.g. 'input') get
  // a narrower reserved set that lets Enter/Escape through.
  const v = validateRebind(actionId, matchers, context);
  if (v) return v;
  // Clear any prior runtime bindings for this actionId so the latest
  // call is authoritative.
  for (const [m, list] of state.runtime) {
    const filtered = list.filter(b => b.actionId !== actionId);
    if (filtered.length === 0) state.runtime.delete(m);
    else state.runtime.set(m, filtered);
  }
  for (const m of matchers) {
    addToLayer(state.runtime, {
      matcher: m.toLowerCase(),
      actionId,
      context,
      when,
      source: 'runtime',
    });
  }
  return null;
}

/** Remove all runtime overrides for an action — used by /rebind reset. */
export function clearRuntimeBindingForAction(actionId: string): void {
  for (const [m, list] of state.runtime) {
    const filtered = list.filter(b => b.actionId !== actionId);
    if (filtered.length === 0) state.runtime.delete(m);
    else state.runtime.set(m, filtered);
  }
}

/** Look up all bindings for a matcher across every layer. Runtime
 *  overrides user-config overrides defaults. Order preserved within
 *  a layer so stable iteration is possible. */
export function lookupBindings(matcher: string): Binding[] {
  const key = matcher.toLowerCase();
  const result: Binding[] = [];
  // Runtime first — highest priority.
  const rt = state.runtime.get(key);
  if (rt) result.push(...rt);
  const uc = state.userConfig.get(key);
  if (uc) result.push(...uc);
  const df = state.defaults.get(key);
  if (df) result.push(...df);
  return result;
}

/** Flatten every binding across every layer — used by GetInputPolicy
 *  and /keys. */
export function listAllBindings(): Binding[] {
  const out: Binding[] = [];
  for (const list of state.runtime.values()) out.push(...list);
  for (const list of state.userConfig.values()) out.push(...list);
  for (const list of state.defaults.values()) out.push(...list);
  return out;
}

function addToLayer(layer: Map<string, Binding[]>, b: Binding): void {
  const key = b.matcher.toLowerCase();
  const list = layer.get(key) ?? [];
  list.push(b);
  layer.set(key, list);
}

/** Test helper — reset the three layers between scenarios. */
export function __resetBindingsForTests(): void {
  state.defaults.clear();
  state.userConfig.clear();
  state.runtime.clear();
}
