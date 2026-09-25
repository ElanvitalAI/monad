// Arc H follow-up — intent-scope miss telemetry.
//
// Counts how many times an LLM-dispatched tool belongs to a scope that
// was NOT active this turn. Purpose: provide objective data for the
// "default-on" transition decision (ROADMAP §7 R2 "miss rate <5%").
//
// Semantics:
//   • Only meaningful when `HARNESS_TOOL_DISCIPLINE_ENABLED=1` —
//     otherwise the gate doesn't filter and "miss" has no meaning.
//   • `'always'` and `'coding'` scopes never miss (always-active lane).
//   • `'ops-fleet' | 'ops-ui' | 'browse' | 'viz' | 'capture'` miss
//     when `lastActiveScopes` doesn't include them.
//
// Life cycle:
//   • gate.ts's evaluateGate() calls setLastActiveScopes() every turn
//     when discipline is enabled. Dispatch then reads the cached set
//     and records misses via recordIntentMiss().
//
// PLAN: 내부 문서 `PLAN-harness-arc-h-follow-up`

import type { ToolIntentScope } from './types.js';

interface MissCount {
  total: number;
  byTool: Record<string, number>;
}

const counts = new Map<ToolIntentScope, MissCount>();
let lastActive: ReadonlySet<ToolIntentScope> | null = null;

/** Gate writes this every turn when discipline is enabled. Dispatch
 *  reads to compare. `null` means no active-scope snapshot has been
 *  computed yet this process — miss recording fails safe (no-op). */
export function setLastActiveScopes(active: ReadonlySet<ToolIntentScope>): void {
  lastActive = active;
}

export function getLastActiveScopes(): ReadonlySet<ToolIntentScope> | null {
  return lastActive;
}

/** Called by dispatchToolByName when a tool with a non-default
 *  intentScope runs. Bails out in 3 cases:
 *    • env not on (discipline disabled — miss is undefined)
 *    • no lastActive snapshot (gate hasn't run yet — fail safe)
 *    • scope is 'always' or 'coding' (always-active lanes)
 *    • scope IS in the active set (hit, not miss) */
export function recordIntentMiss(toolId: string, scope: ToolIntentScope): void {
  if (process.env['HARNESS_TOOL_DISCIPLINE_ENABLED'] !== '1') return;
  if (scope === 'always' || scope === 'coding') return;
  if (!lastActive) return;
  if (lastActive.has(scope)) return;

  const entry = counts.get(scope) ?? { total: 0, byTool: {} };
  entry.total += 1;
  entry.byTool[toolId] = (entry.byTool[toolId] ?? 0) + 1;
  counts.set(scope, entry);
}

/** Snapshot the accumulated miss counts. Consumers (dogfood readout,
 *  `/perf show` follow-up, debug dumps) read via this API. Returned
 *  object is a fresh copy — callers may freely mutate. */
export function getIntentMissCounts(): Record<string, MissCount> {
  const out: Record<string, MissCount> = {};
  for (const [scope, entry] of counts) {
    out[scope] = { total: entry.total, byTool: { ...entry.byTool } };
  }
  return out;
}

export function resetIntentMissCounts(): void {
  counts.clear();
}

/** Test seam — clears counter + active-scope cache between specs. */
export function __resetIntentMissForTests(): void {
  counts.clear();
  lastActive = null;
}
