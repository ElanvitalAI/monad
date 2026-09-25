// H6 P3 Bundle 1 · PolicyRouter engine.
//
// `decide(input)` runs rules in priority order on the current
// `BudgetView` + `OverrideView`. Short-circuits on `prefer` /
// `flag-confirm` / `reject-all`; `filter` narrows the pool for
// later rules; `pass` is a no-op.
//
// Bundle 1 = recommend-only (§D6): `toLaunchSpec(decision, base)`
// materialises a `AgentLaunchSpec` · callers are free to honor or
// ignore. The `requiresConfirmation` flag is the one signal callers
// MUST respect — only R3 raises it and it represents a HITL gate,
// not a routing suggestion.
//
// `lastDecision` is cached so `RouteExplain({})` can retrieve the
// most recent trace without re-running the pipeline.

import { debug } from '../debug/log.js';
import type { AgentLaunchSpec } from '../agent/embodiment.js';
import type { UsageProvider, UsageSnapshot } from '../budget/types.js';
import type { BudgetRecommendation } from '../budget/forecaster.js';
import { forecastSnapshot } from '../budget/forecaster.js';
import { getUsageStore, type UsageStore } from '../budget/usage-store.js';
import { buildCandidatesFromCapabilities, getCapabilitiesStore } from './model-capabilities.js';
import { getOverrideStore, type OverrideStore } from './override-store.js';
import { buildDefaultRules } from './rules.js';
import type {
  BudgetView,
  PolicyRule,
  RouteCandidate,
  RouteContext,
  RouteDecision,
  RouteTrace,
  RouteTraceStep,
  StrengthTag,
} from './types.js';

const STALE_SNAPSHOT_MS = 15 * 60 * 1000; // 15 min

export interface DecideInput {
  readonly task: string;
  readonly estimatedInputTokens?: number;
  readonly strengths?: readonly StrengthTag[];
  readonly preferred?: { brand?: UsageProvider; model?: string };
}

export interface PolicyRouterOpts {
  readonly rules?: readonly PolicyRule[];
  readonly usageStore?: UsageStore;
  readonly overrideStore?: OverrideStore;
  readonly hasLocalLLM?: () => boolean;
  readonly now?: () => number;
}

export class PolicyRouter {
  private readonly rules: readonly PolicyRule[];
  private readonly usageStore: UsageStore;
  private readonly overrideStore: OverrideStore;
  private readonly hasLocalLLM: () => boolean;
  private readonly now: () => number;
  private _lastDecision: RouteDecision | undefined;

  constructor(opts: PolicyRouterOpts = {}) {
    this.rules = (opts.rules ?? buildDefaultRules())
      .slice()
      .sort((a, b) => b.priority - a.priority);
    this.usageStore = opts.usageStore ?? getUsageStore();
    this.overrideStore = opts.overrideStore ?? getOverrideStore();
    this.hasLocalLLM = opts.hasLocalLLM ?? (() => false);
    this.now = opts.now ?? (() => Date.now());
  }

  decide(input: DecideInput): RouteDecision {
    const ctx = this.buildContext(input);
    const allCandidates = buildCandidatesFromCapabilities(ctx, getCapabilitiesStore().list());
    const steps: RouteTraceStep[] = [];
    let pool: readonly RouteCandidate[] = allCandidates;
    let explicitWinner: RouteCandidate | undefined;
    let requiresConfirmation = false;
    const start = this.now();

    for (const rule of this.rules) {
      const result = rule.evaluate(ctx, pool);
      steps.push({ ruleId: rule.id, priority: rule.priority, result });
      if (debug.enabled) {
        debug.log('policy.decide.rule', rule.id, {
          kind: result.kind,
          poolBefore: pool.length,
        });
      }
      if (result.kind === 'prefer') {
        explicitWinner = result.winner;
        break;
      }
      if (result.kind === 'flag-confirm') {
        explicitWinner = result.winner;
        requiresConfirmation = true;
        break;
      }
      if (result.kind === 'filter') {
        pool = result.kept;
      } else if (result.kind === 'reject-all') {
        pool = [];
        break;
      }
    }

    const winner = explicitWinner ?? firstOk(pool) ?? pool[0];
    if (!winner) {
      const trace: RouteTrace = {
        steps,
        finalCandidates: [],
        elapsedMs: this.now() - start,
      };
      throw new PolicyRouterError(
        'PolicyRouter.decide · no viable candidate',
        trace,
      );
    }

    const trace: RouteTrace = {
      steps,
      finalCandidates: [...pool],
      elapsedMs: this.now() - start,
    };
    const decision: RouteDecision = {
      brand: winner.brand,
      ...(winner.model ? { model: winner.model } : {}),
      mode: 'auto',
      confidence: this.calcConfidence(steps, ctx),
      trace,
      requiresConfirmation,
    };
    this._lastDecision = decision;
    if (debug.enabled) {
      debug.log('policy.decide.result', decision.brand, {
        model: decision.model,
        requiresConfirmation,
        confidence: decision.confidence,
        steps: steps.length,
      });
    }
    return decision;
  }

  /** Materialise a decision into an AgentLaunchSpec. Throws when the
   *  winner is flagged `not-yet-implemented` (v1 local-llm case). */
  toLaunchSpec(decision: RouteDecision, base: Partial<AgentLaunchSpec> = {}): AgentLaunchSpec {
    const winnerCandidate = decision.trace.finalCandidates.find(
      (c) => c.brand === decision.brand && (c.model ?? null) === (decision.model ?? null),
    );
    if (winnerCandidate?.availability === 'not-yet-implemented') {
      throw new Error(
        `PolicyRouter.toLaunchSpec · ${decision.brand}${decision.model ? '/' + decision.model : ''} not yet implemented (H6 P2)`,
      );
    }
    return {
      brand: decision.brand,
      mode: decision.mode ?? 'auto',
      ...base,
    } as AgentLaunchSpec;
  }

  lastDecision(): RouteDecision | undefined {
    return this._lastDecision;
  }

  /** Test helper · clear last decision cache so two independent
   *  `decide()` calls in one test don't leak state. */
  _clearLastDecisionForTesting(): void {
    this._lastDecision = undefined;
  }

  // ─── Context builder ───────────────────────────────────────────────

  private buildContext(input: DecideInput): RouteContext {
    const brands: UsageProvider[] = ['codex', 'claude', 'gemini', 'local-llm'];
    const snapshots = new Map<UsageProvider, UsageSnapshot>();
    const recs = new Map<UsageProvider, BudgetRecommendation>();
    for (const b of brands) {
      const snap = this.usageStore.getSnapshot(b);
      if (!snap) continue;
      snapshots.set(b, snap);
      const forecasts = forecastSnapshot(snap, { now: this.now });
      const worst: BudgetRecommendation = forecasts.reduce(
        (a, f) => (rank(f.recommendation) > rank(a) ? f.recommendation : a),
        'safe' as BudgetRecommendation,
      );
      recs.set(b, worst);
    }
    const budget: BudgetView = {
      snapshots,
      recommendations: recs,
      hasLocalLLM: this.hasLocalLLM(),
    };
    return {
      task: input.task,
      ...(input.estimatedInputTokens !== undefined
        ? { estimatedInputTokens: input.estimatedInputTokens }
        : {}),
      ...(input.preferred ? { preferred: input.preferred } : {}),
      ...(input.strengths ? { strengths: input.strengths } : {}),
      budget,
      overrides: this.overrideStore.getView(),
      now: this.now(),
    };
  }

  private calcConfidence(steps: readonly RouteTraceStep[], ctx: RouteContext): number {
    // Simple heuristic (RQ7): 1.0 - 0.1×filters - 0.3×stale_snapshot.
    // Intent: lots of filtering = less confident · stale budget data
    // = much less confident.
    let score = 1.0;
    const filters = steps.filter((s) => s.result.kind === 'filter').length;
    score -= Math.min(0.5, filters * 0.1);
    const now = this.now();
    const anyStale = [...ctx.budget.snapshots.values()].some(
      (s) => now - s.fetchedAt > STALE_SNAPSHOT_MS,
    );
    if (anyStale) score -= 0.3;
    return Math.max(0, Math.min(1, score));
  }
}

export class PolicyRouterError extends Error {
  readonly trace: RouteTrace;
  constructor(message: string, trace: RouteTrace) {
    super(message);
    this.name = 'PolicyRouterError';
    this.trace = trace;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function firstOk(pool: readonly RouteCandidate[]): RouteCandidate | undefined {
  for (const c of pool) {
    if (c.availability === 'ok') return c;
  }
  return undefined;
}

function rank(r: BudgetRecommendation): number {
  if (r === 'throttle') return 2;
  if (r === 'warn') return 1;
  return 0;
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance: PolicyRouter | null = null;

export function getPolicyRouter(): PolicyRouter {
  if (!_instance) _instance = new PolicyRouter();
  return _instance;
}

export function _resetPolicyRouterForTesting(): void {
  _instance = null;
}

export function _setPolicyRouterForTesting(router: PolicyRouter): void {
  _instance = router;
}
