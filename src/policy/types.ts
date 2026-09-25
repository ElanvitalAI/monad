// H6 P3 Bundle 1 · Policy router core types.
//
// Input / output shapes shared by rules · router · override-store ·
// capabilities · LLM tool surface. Designed so that every rule sees
// the same `RouteContext` and every downstream consumer (slash ·
// LLM tool formatter · budget status metadata · agent-handoff
// metadata hook) reads from the same `RouteDecision` + `RouteTrace`.
//
// See `내부 문서 `PLAN-h6-p3-policy-router`` §4.1 for the canonical shape.

import type {
  UsageProvider,
  UsageSnapshot,
  WindowKind,
} from '../budget/types.js';
import type { BudgetRecommendation } from '../budget/forecaster.js';

/** Override priority · how overrides compose into a final decision.
 *  Higher priority wins on conflict — `session-lock` always beats
 *  `per-turn` and `persistent-default`. `throttle-bypass` is **not**
 *  a winner in the main pipeline; it only suppresses rule R3 when
 *  `(brand, window)` matches.  */
export type OverrideScope =
  | 'session-lock'
  | 'per-turn'
  | 'persistent-default'
  | 'throttle-bypass';

/** Permissive throttle bypass · set when the user answers the HITL
 *  gate with "allow until window resets". Keyed by `(brand, model?,
 *  window)` and valid until `expiresAt` (= the target window's
 *  `resetsAt`). Load-time prune removes expired rows. */
export interface ThrottleBypass {
  readonly brand: UsageProvider;
  readonly model?: string;
  readonly window: WindowKind;
  /** Epoch ms · the target window's resetsAt when the bypass was
   *  granted. After this point rule R3 resumes HITL. */
  readonly expiresAt: number;
  readonly createdAt: number;
  /** Free-form snippet captured from the HITL prompt (optional · used
   *  by `/route explain` + trace). */
  readonly reason?: string;
}

/** Static capability declaration for one model · one per `(brand,
 *  model)` key. `available: false` = router keeps it as a candidate
 *  but labels it `not-yet-implemented` so downstream launch throws
 *  cleanly (see §D4). */
export interface ModelCapability {
  readonly brand: UsageProvider;
  readonly model: string;
  /** Context window in tokens. */
  readonly contextWindow: number;
  readonly costTier: 'free' | 'cheap' | 'mid' | 'premium';
  readonly strengths: readonly StrengthTag[];
  readonly available: boolean;
}

export type StrengthTag =
  | 'code'
  | 'research'
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'long-context';

/** Router's view of the overrides at decide-time. Populated by
 *  `OverrideStore.getView()`; rules read from this and never touch
 *  the store directly (keeps rules pure + easy to unit-test). */
export interface OverrideView {
  readonly sessionLock?: { brand: UsageProvider; model?: string; setAt: number };
  readonly perTurn?: { brand: UsageProvider; model?: string };
  readonly persistentDefault?: { brand: UsageProvider; model?: string };
  /** Active (non-expired) throttle bypasses. R3 uses this to decide
   *  whether to skip the HITL gate. */
  readonly throttleBypasses: readonly ThrottleBypass[];
}

/** Router's view of the budget at decide-time. Populated by
 *  `PolicyRouter.buildContext()` from `UsageStore` + `forecaster`. */
export interface BudgetView {
  readonly snapshots: ReadonlyMap<UsageProvider, UsageSnapshot>;
  /** Worst recommendation across a brand's windows (throttle > warn >
   *  safe). Rules use this single label instead of scanning windows
   *  themselves. */
  readonly recommendations: ReadonlyMap<UsageProvider, BudgetRecommendation>;
  /** `true` once H6 P2 (local-llm manager) lands and the fetcher
   *  exits stub mode. Routing rules consult this to decide whether
   *  local-llm is a real candidate or a placeholder. */
  readonly hasLocalLLM: boolean;
}

/** Everything a rule needs to make a decision. Immutable within a
 *  single `decide()` call · each rule returns a `PolicyResult`
 *  instead of mutating context. */
export interface RouteContext {
  readonly task: string;
  readonly estimatedInputTokens?: number;
  readonly preferred?: { brand?: UsageProvider; model?: string };
  readonly strengths?: readonly StrengthTag[];
  readonly budget: BudgetView;
  readonly overrides: OverrideView;
  readonly now: number;
}

export type CandidateAvailability =
  | 'ok'
  | 'budget-saturated'
  | 'unavailable'
  | 'not-yet-implemented';

export interface RouteCandidate {
  readonly brand: UsageProvider;
  readonly model?: string;
  readonly availability: CandidateAvailability;
  readonly capability: ModelCapability | undefined;
}

export type PolicyResult =
  | { kind: 'prefer'; winner: RouteCandidate; reason: string }
  | { kind: 'filter'; kept: readonly RouteCandidate[]; reason: string }
  | { kind: 'flag-confirm'; winner: RouteCandidate; reason: string }
  | { kind: 'pass'; reason?: string }
  | { kind: 'reject-all'; reason: string };

export interface PolicyRule {
  readonly id: string;
  readonly priority: number;
  evaluate(ctx: RouteContext, candidates: readonly RouteCandidate[]): PolicyResult;
}

export interface RouteTraceStep {
  readonly ruleId: string;
  readonly priority: number;
  readonly result: PolicyResult;
}

export interface RouteTrace {
  readonly steps: readonly RouteTraceStep[];
  readonly finalCandidates: readonly RouteCandidate[];
  readonly elapsedMs: number;
}

export interface RouteDecision {
  readonly brand: UsageProvider;
  readonly model?: string;
  readonly mode?: 'auto' | 'acp' | 'native-sdk';
  readonly confidence: number;
  readonly trace: RouteTrace;
  /** True when the HITL gate fired (typically rule R3 budget-throttle
   *  with no matching bypass). Callers MUST NOT auto-launch — they
   *  surface a confirmation UI and let the user answer. */
  readonly requiresConfirmation: boolean;
}
