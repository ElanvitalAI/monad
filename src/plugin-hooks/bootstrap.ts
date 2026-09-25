// ── Core Turn-hooks bootstrap ──
//
// The factories `buildMissionTurnHook` / `buildRouteTurnHook` /
// `buildAndonTurnHook` exist independently but were never auto-registered
// in production. That gap forced
// andon-auto-wire to prepend the Andon preamble directly on the
// skill-runner side as a workaround (ROADMAP §6 A9).
//
// This module provides a single idempotent entry point — invoked
// once from the skill-runner boot path — that registers all four
// core Turn hooks with `globalHookDispatcher`. The direct prepend in
// skill-runner.ts is retained as a safety net (dual-path): if the
// dispatcher is disabled, the preamble still reaches the LLM.

import { globalHookDispatcher } from './dispatcher.js';
import type { HookHandler } from './types.js';
import { buildMissionTurnHook } from '../plugin-missions/turn-hook.js';
import { buildRouteTurnHook } from '../plugin-routes/turn-hook.js';
import { buildAndonTurnHook } from '../cft/andon-turn-hook.js';

let bootstrapped = false;
let disposers: Array<() => void> = [];

function safeRegister(handler: HookHandler<any>): void {
  try {
    const dispose = globalHookDispatcher.register(handler);
    disposers.push(dispose);
  } catch {
    // Handler already registered (test leakage or re-entry). The
    // `bootstrapped` flag normally guards against this; swallow so
    // boot still succeeds.
  }
}

/** Register all three core Turn hooks exactly once per process.
 *  Subsequent calls are no-ops. */
export function bootstrapCoreHooks(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  safeRegister(buildAndonTurnHook());
  safeRegister(buildRouteTurnHook());
  safeRegister(buildMissionTurnHook());
}

/** Test seam — dispose registrations and allow re-bootstrap. */
export function resetCoreHooksBootstrapForTest(): void {
  for (const d of disposers) {
    try { d(); } catch { /* swallow */ }
  }
  disposers = [];
  bootstrapped = false;
}

/** Introspection for tests — snapshot of whether bootstrap ran. */
export function isCoreHooksBootstrappedForTest(): boolean {
  return bootstrapped;
}
