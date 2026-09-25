// W9b Z15.b · Capability resolver — apply OMF `requires.optional` against
// the detected device fleet. Cf. ROADMAP §3 S23 + §4 Z15.b + §4b.3.
//
// Given a template's `requires.optional[]` declaration + a
// `DeviceCapabilitySet`, the resolver decides per-row whether the
// capability set fires the `enables` block or falls back to
// `degrade_to`. The output is a flat `CapabilityDecision[]` plus a
// rolled-up `EnablementSet` the surface layer can ask
// "should I render the wrist-flip CTA?" against.
//
// The resolver is pure — no IO, no filesystem. Production callers run
// it on every `DeviceCapabilitySet` change (see upgrade-watcher.ts).

import type { DeviceCapabilitySet, DeviceKind } from './device-detector.js';

export interface OptionalRequirement {
  device: DeviceKind;
  /** Either a single capability or a list. The resolver requires ALL
   *  capabilities listed (AND-join) to fire `enables`. */
  capability: string | readonly string[];
  /** Enablement tokens the resolver surfaces when the requirement is
   *  met. The surface layer keys CTAs / chip render on these. */
  enables: readonly string[];
  /** Single fallback token when the requirement is unmet. The surface
   *  layer renders the degraded path keyed on this. */
  degrade_to: string;
}

export type RequirementOutcome =
  | { status: 'enabled';  enables: readonly string[] }
  | { status: 'degraded'; degradeTo: string; missing: readonly string[] };

export interface CapabilityDecision {
  requirement: OptionalRequirement;
  outcome: RequirementOutcome;
}

export interface EnablementSet {
  /** All enable tokens fired across requirements. */
  enabled: Set<string>;
  /** Degrade tokens for unmet requirements. */
  degraded: Set<string>;
  /** Per-requirement decision rows, in declaration order. */
  decisions: CapabilityDecision[];
}

export interface FallbackChainEntry {
  /** Boolean expression over the fleet — supported tokens:
   *   - `no <device-kind>`   — fleet count for the kind is 0
   *   - `has <device-kind>`  — fleet count for the kind is ≥1
   *  Operators: `&&` (AND), `||` (OR). Parens not supported (KISS;
   *  templates with complex predicates can split into multiple rows).
   */
  if: string;
  then: string;
}

export interface ResolveOpts {
  optionalRequirements: readonly OptionalRequirement[];
  fallbackChain?: readonly FallbackChainEntry[];
  fleet: DeviceCapabilitySet;
}

export interface ResolveResult {
  enablement: EnablementSet;
  /** Fallback chain `then` strings whose `if` clause evaluates true.
   *  Ordered as declared so the surface layer can render the first
   *  match prominently. */
  fallbackHits: string[];
}

export function resolveCapabilities(opts: ResolveOpts): ResolveResult {
  const enabled = new Set<string>();
  const degraded = new Set<string>();
  const decisions: CapabilityDecision[] = [];

  for (const req of opts.optionalRequirements) {
    const decision = decideRequirement(req, opts.fleet);
    decisions.push(decision);
    if (decision.outcome.status === 'enabled') {
      for (const tok of decision.outcome.enables) enabled.add(tok);
    } else {
      degraded.add(decision.outcome.degradeTo);
    }
  }

  const fallbackHits = (opts.fallbackChain ?? [])
    .filter((entry) => evalFallbackExpr(entry.if, opts.fleet))
    .map((entry) => entry.then);

  return {
    enablement: { enabled, degraded, decisions },
    fallbackHits,
  };
}

function decideRequirement(
  req: OptionalRequirement,
  fleet: DeviceCapabilitySet,
): CapabilityDecision {
  const hasDevice = fleet.count(req.device) > 0;
  if (!hasDevice) {
    return {
      requirement: req,
      outcome: { status: 'degraded', degradeTo: req.degrade_to, missing: [`device:${req.device}`] },
    };
  }
  const needed = Array.isArray(req.capability) ? req.capability : [req.capability];
  const deviceCaps = fleet.byKind.get(req.device) ?? new Set<string>();
  const missing = needed.filter((cap) => !deviceCaps.has(cap));
  if (missing.length > 0) {
    return {
      requirement: req,
      outcome: { status: 'degraded', degradeTo: req.degrade_to, missing: missing.map((m) => `capability:${m}`) },
    };
  }
  return {
    requirement: req,
    outcome: { status: 'enabled', enables: req.enables },
  };
}

/** Tokenise `expr` and reduce against the fleet. Supports `no X`,
 *  `has X`, and `&&` / `||` between them. The grammar is intentionally
 *  flat — templates with more complex predicates split into multiple
 *  rows. */
export function evalFallbackExpr(expr: string, fleet: DeviceCapabilitySet): boolean {
  const trimmed = expr.trim();
  if (trimmed === '') return false;

  // Split on `||` first (lower precedence); each disjunct is `&&`-joined.
  const ors = splitTop(trimmed, '||');
  for (const orPart of ors) {
    const ands = splitTop(orPart, '&&');
    if (ands.every((clause) => evalClause(clause.trim(), fleet))) {
      return true;
    }
  }
  return false;
}

function splitTop(s: string, sep: string): string[] {
  return s.split(sep);
}

function evalClause(clause: string, fleet: DeviceCapabilitySet): boolean {
  const m = clause.match(/^(no|has)\s+([a-z0-9-]+)$/i);
  if (!m) return false;
  const op = m[1]!.toLowerCase();
  const kind = m[2]!.toLowerCase();
  const count = fleet.count(kind as DeviceKind);
  if (op === 'no')  return count === 0;
  if (op === 'has') return count > 0;
  return false;
}

/** True when the resolver fired any enable token. The surface uses this
 *  to decide whether the "rich mode" UI affordances should render at all. */
export function hasAnyEnablement(set: EnablementSet): boolean {
  return set.enabled.size > 0;
}
