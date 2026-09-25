// Action registry — every dispatchable behavior addressable via the
// unified input policy has a string id and a handler.
//
// Why a registry (vs direct function calls):
//   - Bindings point at action IDs in JSON. User-config and LLM
//     rebinds refer to actions by name, not by closure.
//   - GetInputPolicy() introspection returns the action catalog so
//     the LLM can pick a valid target for SetInputBinding.
//   - Testability: tests can stub handlers without touching the
//     dispatcher.
//
// References:
//   - vscode `CommandsRegistry.registerCommand(id, handler)`
//   - zed `actions!(namespace, [...])` macro
//
// The registry is intentionally a singleton module with a reset
// helper for tests. No class, no constructor — actions are process-
// global anyway.

import { isReservedActionId } from './reserved.js';

export interface ActionHandler {
  (): void | Promise<void>;
}

export interface ActionDefinition {
  id: string;
  handler: ActionHandler;
  /** Short human-readable description — shown by /keys and included
   *  in GetInputPolicy output. */
  description?: string;
  /** When true, SetInputBinding may not replace bindings for this
   *  action. `reserved` is the ACTION-level flag; RESERVED_ACTION_IDS
   *  from ./reserved.ts is the GLOBAL list — both are checked. */
  reserved?: boolean;
}

const actions = new Map<string, ActionDefinition>();

export interface RegisterActionOptions extends ActionDefinition {
  /** When true, re-register silently overwrites an existing entry.
   *  Used by the Phase 2 bootstrap that seeds actions from legacy
   *  keybindings — subsequent calls during the same process must
   *  replace, not panic. */
  allowOverwrite?: boolean;
}

/** Register (or replace, when allowOverwrite is set) an action. */
export function registerAction(opts: RegisterActionOptions): void {
  const existing = actions.get(opts.id);
  if (existing && !opts.allowOverwrite) {
    throw new Error(`Action "${opts.id}" is already registered.`);
  }
  const { allowOverwrite: _overwrite, ...def } = opts;
  actions.set(opts.id, def);
}

/** Look up an action. Returns null when the id is unknown. */
export function getAction(id: string): ActionDefinition | null {
  return actions.get(id) ?? null;
}

/** Whether an action exists. */
export function hasAction(id: string): boolean {
  return actions.has(id);
}

/** Snapshot of all registered action definitions — used by
 *  GetInputPolicy() and /keys. Returns a fresh array; mutation is
 *  a caller concern. Sorted by id for stable output. */
export function listActions(): ActionDefinition[] {
  return [...actions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Is this action protected from rebinding? Composes the per-action
 *  `reserved` flag with the global `RESERVED_ACTION_IDS` list. */
export function isActionReserved(id: string): boolean {
  if (isReservedActionId(id)) return true;
  const def = actions.get(id);
  return def?.reserved === true;
}

/** Test helper — wipe the registry between scenarios so assertion
 *  state doesn't leak across tests. NOT exposed at runtime; callers
 *  in production should use allowOverwrite: true on their
 *  registerAction calls instead. */
export function __resetActionRegistryForTests(): void {
  actions.clear();
}
