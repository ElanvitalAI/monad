// H6 P3 Bundle 1 · Default rule set (7 rules · priority-desc order).
//
// Each rule is a pure TS function `(ctx, candidates) => PolicyResult`.
// The router evaluates rules in priority order; the first
// `prefer` / `flag-confirm` / `reject-all` short-circuits. `filter`
// narrows the candidate pool for subsequent rules. `pass` is a no-op
// with an optional reason recorded in the trace.
//
// Rules (priority desc):
//   R1 · 100  session-lock          — user locked the session to a brand
//   R2 ·  90  per-turn mention      — `@claude-opus` in this turn
//   R3 ·  80  budget-throttle       — ≥95% → HITL · bypass-aware (§D9)
//   R4 ·  70  budget-warn           — 80-95% → redirect via fallback chain
//   R5 ·  60  capability-filter     — context-window + strength-tag
//   R6 ·  20  persistent-default    — tie-break toward user default
//   R7 ·  10  cloud-first-ordering  — push local-llm to the end pre-P2
//
// Only R3 ever raises the HITL flag (`flag-confirm`). Per-turn (R2)
// deliberately does NOT override R3: the user's explicit pick still
// passes through the throttle gate so budget safety wins over
// convenience (C3 resolution). R1 (session-lock) same — you can lock
// to Opus but still get a "really?" at 97%.

import type {
  PolicyRule,
  PolicyResult,
  RouteCandidate,
  RouteContext,
  StrengthTag,
} from './types.js';
import { getFallbackChain, type FallbackChain } from './fallback-chain.js';

// ─── R1 · session-lock ───────────────────────────────────────────────

export function ruleSessionLock(): PolicyRule {
  return {
    id: 'session-lock',
    priority: 100,
    evaluate(ctx, candidates): PolicyResult {
      const lock = ctx.overrides.sessionLock;
      if (!lock) return { kind: 'pass' };
      const match = findCandidate(candidates, lock.brand, lock.model);
      if (!match) {
        return {
          kind: 'pass',
          reason: `session-lock ${lock.brand}${lock.model ? '/' + lock.model : ''} has no matching capability · ignored`,
        };
      }
      if (match.availability !== 'ok') {
        return {
          kind: 'pass',
          reason: `session-lock target unavailable (${match.availability}) · ignored`,
        };
      }
      return {
        kind: 'filter',
        kept: [match],
        reason: `session-lock ${lock.brand}${lock.model ? '/' + lock.model : ''}`,
      };
    },
  };
}

// ─── R2 · per-turn mention ───────────────────────────────────────────

export function rulePerTurnMention(): PolicyRule {
  return {
    id: 'per-turn',
    priority: 90,
    evaluate(ctx, candidates): PolicyResult {
      const preferred = ctx.overrides.perTurn ?? ctx.preferred;
      if (!preferred?.brand) return { kind: 'pass' };
      const match = findCandidate(candidates, preferred.brand, preferred.model);
      if (!match) {
        return {
          kind: 'pass',
          reason: `per-turn @${preferred.brand}${preferred.model ? '/' + preferred.model : ''} · no matching capability`,
        };
      }
      if (match.availability === 'not-yet-implemented') {
        return {
          kind: 'pass',
          reason: `per-turn target not-yet-implemented (H6 P2)`,
        };
      }
      if (match.availability === 'unavailable') {
        return {
          kind: 'pass',
          reason: `per-turn target unavailable`,
        };
      }
      // Narrow to this candidate · still subject to R3 throttle gate.
      return {
        kind: 'filter',
        kept: [match],
        reason: `per-turn @${preferred.brand}${preferred.model ? '/' + preferred.model : ''}`,
      };
    },
  };
}

// ─── R3 · budget-throttle (HITL) ─────────────────────────────────────

export function ruleBudgetThrottle(): PolicyRule {
  return {
    id: 'budget-throttle',
    priority: 80,
    evaluate(ctx, candidates): PolicyResult {
      // Viable = real candidates we could actually launch. Unavailable
      // and not-yet-implemented brands are not "escape hatches" — they
      // mustn't silently let the router skip the HITL gate.
      const viable = candidates.filter(
        (c) => c.availability === 'ok' || c.availability === 'budget-saturated',
      );
      if (viable.length === 0) return { kind: 'pass' };
      const throttled = viable.filter(
        (c) => ctx.budget.recommendations.get(c.brand) === 'throttle',
      );
      if (throttled.length === 0) return { kind: 'pass' };
      if (throttled.length < viable.length) {
        return {
          kind: 'filter',
          kept: candidates.filter(
            (c) => ctx.budget.recommendations.get(c.brand) !== 'throttle',
          ),
          reason: 'budget-throttle · dropped throttled candidates',
        };
      }
      // All viable candidates are on throttled brands — HITL on the
      // top of that pool. Check bypass first.
      const winner = viable[0]!;
      const bypassMatch = ctx.overrides.throttleBypasses.find(
        (b) =>
          b.brand === winner.brand &&
          b.expiresAt > ctx.now &&
          (b.model === undefined || b.model === winner.model),
      );
      if (bypassMatch) {
        return {
          kind: 'prefer',
          winner,
          reason: `budget-throttle · bypass active (${winner.brand}${winner.model ? '/' + winner.model : ''} · expires ${new Date(bypassMatch.expiresAt).toISOString()})`,
        };
      }
      return {
        kind: 'flag-confirm',
        winner,
        reason: `budget-throttle · ${winner.brand}${winner.model ? '/' + winner.model : ''} ≥95% used · HITL required`,
      };
    },
  };
}

// ─── R4 · budget-warn (redirect) ─────────────────────────────────────

export function ruleBudgetWarn(opts: { chain?: FallbackChain } = {}): PolicyRule {
  return {
    id: 'budget-warn',
    priority: 70,
    evaluate(ctx, candidates): PolicyResult {
      const chain = opts.chain ?? getFallbackChain();
      const warnBrands = new Set(
        [...ctx.budget.recommendations.entries()]
          .filter(([, r]) => r === 'warn')
          .map(([b]) => b),
      );
      if (warnBrands.size === 0) return { kind: 'pass' };
      const top = pickTopCandidate(candidates);
      if (!top || !warnBrands.has(top.brand)) {
        return { kind: 'pass', reason: 'budget-warn · top candidate not on warn brand' };
      }
      const alt = chain.pickNext({
        candidates,
        recommendations: ctx.budget.recommendations,
        excluded: top,
        avoidBrands: [top.brand], // brand-level window · same-brand model swap 는 도움 안 됨
      });
      if (!alt) {
        return {
          kind: 'pass',
          reason: `budget-warn · ${top.brand} at warn but no fallback candidate available`,
        };
      }
      return {
        kind: 'prefer',
        winner: alt,
        reason: `budget-warn · ${top.brand}${top.model ? '/' + top.model : ''} at 80-95% · redirected to ${alt.brand}${alt.model ? '/' + alt.model : ''}`,
      };
    },
  };
}

// ─── R5 · capability-filter ──────────────────────────────────────────

export function ruleCapabilityFilter(): PolicyRule {
  return {
    id: 'capability-filter',
    priority: 60,
    evaluate(ctx, candidates): PolicyResult {
      const needContext = ctx.estimatedInputTokens
        ? Math.floor(ctx.estimatedInputTokens * 1.2) // 20% safety margin
        : 0;
      const needStrengths = ctx.strengths ?? [];
      const kept = candidates.filter((c) => {
        if (!c.capability) return true; // unknown capability · keep
        if (needContext > 0 && c.capability.contextWindow < needContext) return false;
        if (needStrengths.length > 0) {
          const matches = needStrengths.filter((s: StrengthTag) =>
            c.capability!.strengths.includes(s),
          );
          if (matches.length === 0) return false;
        }
        return true;
      });
      if (kept.length === candidates.length) {
        return { kind: 'pass', reason: 'capability-filter · all candidates match' };
      }
      if (kept.length === 0) {
        return { kind: 'pass', reason: 'capability-filter · no candidate matches · skipping filter' };
      }
      return {
        kind: 'filter',
        kept,
        reason: `capability-filter · kept ${kept.length}/${candidates.length} by context=${needContext} strengths=${needStrengths.join(',') || '—'}`,
      };
    },
  };
}

// ─── R6 · persistent-default ─────────────────────────────────────────

export function rulePersistentDefault(): PolicyRule {
  return {
    id: 'persistent-default',
    priority: 20,
    evaluate(ctx, candidates): PolicyResult {
      const dflt = ctx.overrides.persistentDefault;
      if (!dflt) return { kind: 'pass' };
      const match = findCandidate(candidates, dflt.brand, dflt.model);
      if (!match || match.availability !== 'ok') {
        return {
          kind: 'pass',
          reason: `persistent-default ${dflt.brand}${dflt.model ? '/' + dflt.model : ''} unavailable · falling through`,
        };
      }
      return {
        kind: 'prefer',
        winner: match,
        reason: `persistent-default ${dflt.brand}${dflt.model ? '/' + dflt.model : ''}`,
      };
    },
  };
}

// ─── R7 · cloud-first ordering ───────────────────────────────────────

export function ruleCloudFirstOrdering(): PolicyRule {
  return {
    id: 'cloud-first-ordering',
    priority: 10,
    evaluate(_ctx, candidates): PolicyResult {
      const cloud = candidates.filter((c) => c.brand !== 'local-llm');
      const local = candidates.filter((c) => c.brand === 'local-llm');
      if (cloud.length === 0 || local.length === 0) {
        return { kind: 'pass', reason: 'cloud-first · no reordering needed' };
      }
      return {
        kind: 'filter',
        kept: [...cloud, ...local],
        reason: 'cloud-first · cloud brands precede local-llm',
      };
    },
  };
}

// ─── Default set ─────────────────────────────────────────────────────

export function buildDefaultRules(opts: { fallback?: FallbackChain } = {}): PolicyRule[] {
  return [
    ruleSessionLock(),
    rulePerTurnMention(),
    ruleBudgetThrottle(),
    ruleBudgetWarn(opts.fallback ? { chain: opts.fallback } : {}),
    ruleCapabilityFilter(),
    rulePersistentDefault(),
    ruleCloudFirstOrdering(),
  ];
}

// ─── Shared helpers ──────────────────────────────────────────────────

export function findCandidate(
  candidates: readonly RouteCandidate[],
  brand: string,
  model: string | undefined,
): RouteCandidate | undefined {
  return candidates.find(
    (c) => c.brand === brand && (model === undefined || c.model === model),
  );
}

export function pickTopCandidate(
  candidates: readonly RouteCandidate[],
): RouteCandidate | undefined {
  // "Top" = first `ok` entry in the current pool order. Callers who
  // want different preference (cost-asc / cost-desc) reorder before
  // passing in. R3 uses this to flag the HITL winner; R4 uses it to
  // decide whether the current top is the throttled one.
  for (const c of candidates) {
    if (c.availability === 'ok') return c;
  }
  return candidates[0];
}
