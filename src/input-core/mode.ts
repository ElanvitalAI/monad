// Mode abstraction + ModeManager singleton.
//
// Phase 4 of the unified-input plan. Codifies the top-level operating
// modes the user can switch between:
//
//   general — default conversational / development mode.
//   control — LLM-directed dashboard automation (legacy UI name:
//             dashboard-control
//             via chat-mode.ts + skill-tool-control.ts).
//
// Sync was removed in Arc A (harness-engineering meta-track) — it is
// owned by the PluginHost (`pluginHost.activate('sync')` →
// `plugins/sync/plugin.ts`), not by ModeManager. Plan mode and Vi
// mode remain orthogonal concerns (plan mode gates Edit/Write
// regardless of operating mode; vi is a pane-local text editor). This
// abstraction is intentionally narrow: one active operating mode at a
// time.
//
// Wiring strategy: the ModeManager delegates onEnter/onExit to
// concrete `Mode` implementations, which can live alongside the
// existing entry points (chat-mode.ts). The manager owns the
// context-stack push/pop so the resolver's gating stays coherent.

import { pushContext, popContext, type ContextTag } from './context.js';

export type ModeId = 'general' | 'control';

export interface Mode {
  id: ModeId;
  title: string;
  /** Context tag pushed when this mode is active. Must match a tag
   *  in ContextTag. Omit for modes that have no resolver-level gate. */
  contextTag?: ContextTag;
  /** Fires when the mode activates. Implementations delegate to the
   *  existing entry function (pluginHost.activate('sync'), etc.).
   *  May return a cleanup function; otherwise the mode's own onExit
   *  is used. */
  onEnter(): Promise<void> | void;
  /** Fires when the mode deactivates. */
  onExit(): Promise<void> | void;
}

const registry = new Map<ModeId, Mode>();
let active: ModeId = 'general';

/** Observer pattern — fires after every successful mode transition
 *  with `(next, prev)`. Primary consumer is `wireInputModeContextBridge`
 *  (maps ModeId → `controlModeActive` ContextKey · `syncModeActive`
 *  is a deprecated always-false alias kept for compatibility) so
 *  when-clauses can gate bindings on the current operating mode. */
export type ModeChangeListener = (next: ModeId, prev: ModeId) => void;
const listeners = new Set<ModeChangeListener>();

export function subscribeMode(fn: ModeChangeListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function fireModeChange(next: ModeId, prev: ModeId): void {
  for (const fn of listeners) {
    try { fn(next, prev); }
    catch {
      // Swallow — a throwing listener must not poison sibling
      // subscribers or stop `setMode` from completing.
    }
  }
}

export function registerMode(mode: Mode): void {
  registry.set(mode.id, mode);
}

export function getMode(id: ModeId): Mode | null {
  return registry.get(id) ?? null;
}

export function listModes(): Mode[] {
  return [...registry.values()];
}

export function activeMode(): ModeId {
  return active;
}

/** Switch to a new mode. No-op when already on `next`. Calls the
 *  previous mode's onExit (if registered) then the new mode's
 *  onEnter. Pushes/pops context tags accordingly.
 *
 *  Returns the active mode after the transition — equals `next` on
 *  success, or the prior mode when `next` isn't registered. */
export async function setMode(next: ModeId): Promise<ModeId> {
  if (next === active) return active;

  const current = registry.get(active);
  if (current) {
    if (current.contextTag) popContext(current.contextTag);
    try { await current.onExit(); }
    catch { /* mode cleanup errors are best-effort — stay in next */ }
  }

  const target = registry.get(next);
  if (!target) {
    // Unknown mode — leave `active` where it was and surface the
    // missing registration via console.error. The resolver gate never
    // saw a matching context tag, so no partial state.
    console.error(`[input-core/mode] setMode("${next}"): mode not registered.`);
    return active;
  }

  try { await target.onEnter(); }
  catch (err) {
    console.error(`[input-core/mode] setMode("${next}") onEnter threw:`, err);
    return active;   // stay in previous mode; target never took over
  }
  if (target.contextTag) pushContext(target.contextTag);
  const prev = active;
  active = next;
  fireModeChange(active, prev);
  return active;
}

/** Test helper — reset to default state. */
export function __resetModeManagerForTests(): void {
  registry.clear();
  listeners.clear();
  active = 'general';
}

/** Register the two built-in modes with no-op handlers. Callers
 *  (dashboard.ts, chat-mode.ts) override these via registerMode()
 *  with real onEnter / onExit implementations during their own
 *  bootstrap. Having the placeholders here means GetInputPolicy()
 *  can enumerate the modes even before the live bindings are
 *  plugged in. */
export function registerBuiltInModes(): void {
  registerMode({
    id: 'general',
    title: 'General',
    onEnter: () => {},
    onExit: () => {},
  });
  registerMode({
    id: 'control',
    title: 'Control',
    contextTag: 'control-mode',
    onEnter: () => {},
    onExit: () => {},
  });
}
