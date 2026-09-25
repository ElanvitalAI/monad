// M3-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// `GET /v1/budget/status` endpoint.
//
// Joins the live voice cost tracker (`globalVoiceCostTracker().getMonthSummary`)
// with the user-config `budget` sub-tree (cap · notify threshold ·
// fallback tier) and returns the BudgetGuard evaluation so the PWA can
// decide whether to show the threshold modal.
//
// Read-only — applying the fallback (Switch / Local-only) goes through
// the existing `PUT /v1/config/model-tier` route via PWA helpers
// (`pushSttTierToDaemon` etc.). Keeping mutation paths consolidated
// avoids double-write races and re-uses the existing validation.
//
// Reference: PLAN §3.4 (Budget-guarded auto-fallback) +
// 내부 문서
// §2.A entry steps.

import {
  evaluateBudget,
  type BudgetEvaluation,
} from '../../budget-guard/budget-guard.js';
import { buildUserConfig, userConfigPath } from '../../user-config.js';
import { globalVoiceCostTracker } from '../../voice/cost-tracker.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface BudgetStatusBody extends BudgetEvaluation {
  /** Echoed back so the PWA modal can render "$40 of $50" without a
   *  second round-trip to `/v1/config/model-tier`. */
  monthSoFarUsd: number;
  /** YYYY-MM the figure pertains to — for the modal subhead and as a
   *  dismissal key (don't nag again for the same threshold + month). */
  monthYYYYMM: string;
}

export function handleBudgetStatusGet(): Response {
  const cfg = buildUserConfig(userConfigPath());
  const summary = globalVoiceCostTracker().getMonthSummary();
  const evaluation = evaluateBudget({
    budget: cfg.budget,
    monthSoFarUsd: summary.totalUsd,
  });
  const body: BudgetStatusBody = {
    ...evaluation,
    monthSoFarUsd: summary.totalUsd,
    monthYYYYMM: summary.monthYYYYMM,
  };
  return jsonResponse(body, 200);
}
