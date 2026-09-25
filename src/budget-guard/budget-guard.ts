// M3-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Budget-guarded auto-fallback evaluator (pillar 4 · §3.4).
//
// Pure function over `(BudgetUserConfig, monthSoFarUsd)` returning the
// three-state evaluation the PWA modal + daemon endpoint share:
//
//   ok          monthSoFar < cap × (notifyAtPct / 100)
//   warning     cap × (notifyAtPct / 100) ≤ monthSoFar < cap
//   cap-exceeded                            monthSoFar ≥ cap
//
// Decision M4 — undefined `monthlyUsdCap` means "passive · cost dashboard
// only · no fallback"; the evaluator returns `ok` regardless of spend.
// Decision M7 — default fallback tier is `budget` when the user accepts
// the modal recommendation but didn't pin a specific `fallbackTier`.
//
// Reference: PLAN §3.4 (Budget-guarded auto-fallback) + §4.4 (modal
// shape · 3-option radio).

import type { BudgetUserConfig, ModelTier } from '../model-tier/types.js';

export type BudgetStatus = 'ok' | 'warning' | 'cap-exceeded';

export interface BudgetEvaluation {
  status: BudgetStatus;
  /** monthSoFarUsd ÷ cap × 100. `null` when no cap is set (no
   *  meaningful percentage exists). Capped at 999 to keep UI strings
   *  short on runaway months. */
  percent: number | null;
  /** Monthly USD cap echoed back so the PWA modal can render
   *  "$40/$50" without re-reading the same config. `undefined` when no
   *  cap is configured. */
  monthlyUsdCap?: number;
  /** Tier the modal should pre-select on the "Switch to fallback"
   *  radio. Always populated for `warning` / `cap-exceeded` so the
   *  modal has something to apply on a 1-click confirm. */
  recommendedFallback?: ModelTier;
  /** notifyAtPct echoed back for "(80%)" subtext in the modal header. */
  notifyAtPct: number;
}

/** Default tier for `recommendedFallback` when the user hasn't pinned
 *  one — decision M7. */
export const DEFAULT_FALLBACK_TIER: ModelTier = 'budget';

/** Default notify threshold — 80% of cap. The modal fires once we cross
 *  this; before that the `getMonthSummary` pill in the status bar is
 *  the only signal. */
export const DEFAULT_NOTIFY_AT_PCT = 80;

export interface EvaluateBudgetOpts {
  budget: BudgetUserConfig | undefined;
  monthSoFarUsd: number;
}

export function evaluateBudget(opts: EvaluateBudgetOpts): BudgetEvaluation {
  const budget = opts.budget ?? {};
  const cap = budget.monthlyUsdCap;
  const notifyAtPct = clampPct(budget.notifyAtPct ?? DEFAULT_NOTIFY_AT_PCT);
  const fallback = budget.fallbackTier ?? DEFAULT_FALLBACK_TIER;
  const monthSoFar = Math.max(0, opts.monthSoFarUsd);

  // No cap configured → passive mode (decision M4).
  if (cap === undefined || cap <= 0) {
    return {
      status: 'ok',
      percent: null,
      notifyAtPct,
    };
  }

  const rawPercent = (monthSoFar / cap) * 100;
  const percent = Math.min(999, Math.round(rawPercent * 10) / 10);
  const warnAt = cap * (notifyAtPct / 100);

  if (monthSoFar >= cap) {
    return {
      status: 'cap-exceeded',
      percent,
      monthlyUsdCap: cap,
      recommendedFallback: fallback,
      notifyAtPct,
    };
  }
  if (monthSoFar >= warnAt) {
    return {
      status: 'warning',
      percent,
      monthlyUsdCap: cap,
      recommendedFallback: fallback,
      notifyAtPct,
    };
  }
  return {
    status: 'ok',
    percent,
    monthlyUsdCap: cap,
    notifyAtPct,
  };
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_NOTIFY_AT_PCT;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
