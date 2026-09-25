// ── PFC-S5 P4: recommendModel pure decision fn ──
//
// Deterministic ranking so the LLM's next-model choice is reproducible
// and easy to unit-test. Rules (in order):
//
//   1. Match taskType against tags + bestFor (union).
//   2. Context-window >= contextSize hint.
//   3. Drop models whose envKey is not present in env.
//   4. Drop local models whose minRamGb > free RAM.
//   5. If weekly cap status === 'tripped' OR status === 'warning' AND
//      the operator passed latencyTarget='slow' (treat warning as hard
//      stop for batch work), drop paid models.
//   6. If force_local → drop non-local.
//   7. Sort: local first, then price asc (avg of input + output / 2).
//   8. Top = recommended; next 3 = alternatives.
//
// The function never throws — empty candidate set returns a clear
// reasoning string so the LLM can surface "no model fits" to the
// operator.

import type {
  CostCapConfig,
  CostCapStatus,
  CostSnapshot,
  ModelCatalog,
  ModelEntry,
  SystemSnapshot,
} from './types.js';
import {
  weeklyCapStatus,
  monthlyCapStatus,
} from './cost-meter.js';
import { enabledModels } from './model-catalog.js';

export type TaskType =
  | 'reasoning'
  | 'coding'
  | 'classification'
  | 'summarization'
  | 'embedding'
  | 'cheap'
  | 'local_preferred'
  | 'long_context';

export interface RecommendHints {
  contextSize?: number;
  latencyTarget?: 'fast' | 'normal' | 'slow';
  maxUsdPerCall?: number;
  forceLocal?: boolean;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

export interface RecommendContext {
  catalog: ModelCatalog;
  system: SystemSnapshot;
  cost: CostSnapshot;
  costConfig: CostCapConfig;
  env?: NodeJS.ProcessEnv;
}

// NOTE: declared as a `type` (object literal), NOT an `interface`, on
// purpose. This shape is used as the `Out` type argument of
// `ToolRuntime<Req, Out extends ToolRunResult>` (see
// src/tool-runtime/intelligence-map-runtimes.ts → routeToModelRuntime).
// `ToolRunResult` is `{ output: string } | Record<string, unknown>`, and
// only object-literal type aliases receive an implicit string index
// signature — an `interface` does not, so it would fail to satisfy the
// `Record<string, unknown>` arm of that constraint (TS2344).
export type ModelRecommendation = {
  recommended?: string;
  alternatives: string[];
  reasoning: string;
  estimatedCostUsd?: number;
  diagnostics: Record<string, string>;
  capStatus: CostCapStatus;
};

export function recommendModel(
  taskType: TaskType,
  hints: RecommendHints,
  ctx: RecommendContext,
): ModelRecommendation {
  const diagnostics: Record<string, string> = {};
  const env = ctx.env ?? process.env;

  const capStatusWeekly = weeklyCapStatus(ctx.cost, ctx.costConfig);
  const capStatusMonthly = monthlyCapStatus(ctx.cost, ctx.costConfig);
  const capStatus: CostCapStatus =
    capStatusWeekly === 'tripped' || capStatusMonthly === 'tripped' ? 'tripped' :
    capStatusWeekly === 'warning' || capStatusMonthly === 'warning' ? 'warning' : 'ok';
  diagnostics.cap_status = `weekly=${capStatusWeekly}, monthly=${capStatusMonthly}`;

  // 1+2+3: tag/context/envKey filter
  let candidates = enabledModels(ctx.catalog, env);
  diagnostics.enabled = `${candidates.length} after envKey filter`;

  candidates = candidates.filter(m =>
    m.tags.includes(taskType) || m.bestFor.includes(taskType) ||
    (taskType === 'long_context' && m.contextWindow >= 500_000) ||
    (taskType === 'cheap' && m.inputPerMtok < 1 && m.outputPerMtok < 5) ||
    (taskType === 'local_preferred' && m.local)
  );
  diagnostics.task_match = `${candidates.length} after taskType filter`;

  if (hints.contextSize) {
    candidates = candidates.filter(m => m.contextWindow >= hints.contextSize!);
    diagnostics.context = `${candidates.length} after contextSize ≥ ${hints.contextSize}`;
  }

  // 4: local RAM gate
  candidates = candidates.filter(m => {
    if (!m.local) return true;
    if (!m.minRamGb) return true;
    return ctx.system.freeMemGb >= m.minRamGb;
  });
  diagnostics.ram = `${candidates.length} after RAM gate (free=${ctx.system.freeMemGb.toFixed(1)}GB)`;

  // 5: budget gate
  if (capStatus === 'tripped') {
    candidates = candidates.filter(m => m.local);
    diagnostics.budget_gate = 'weekly/monthly cap tripped → local only';
  } else if (capStatus === 'warning' && hints.latencyTarget === 'slow') {
    candidates = candidates.filter(m => m.local);
    diagnostics.budget_gate = 'warning + batch work → local only';
  }

  // 6: force local
  if (hints.forceLocal) {
    candidates = candidates.filter(m => m.local);
    diagnostics.force_local = 'forced';
  }

  // 7: sort — local first, then price
  candidates.sort((a, b) => {
    if (a.local !== b.local) return a.local ? -1 : 1;
    const aPrice = (a.inputPerMtok + a.outputPerMtok) / 2;
    const bPrice = (b.inputPerMtok + b.outputPerMtok) / 2;
    return aPrice - bPrice;
  });

  if (candidates.length === 0) {
    return {
      alternatives: [],
      reasoning: `No model matches taskType='${taskType}' under the current constraints.`,
      diagnostics,
      capStatus,
    };
  }

  // 8: maxUsdPerCall gate (applied after sort so the picked candidate fits)
  const top = candidates[0]!;
  const estInput = hints.estimatedInputTokens ?? 2000;
  const estOutput = hints.estimatedOutputTokens ?? 1000;
  const est = estimateCost(top, estInput, estOutput);

  if (hints.maxUsdPerCall !== undefined && est > hints.maxUsdPerCall) {
    const cheap = candidates.find(m => estimateCost(m, estInput, estOutput) <= hints.maxUsdPerCall!);
    if (cheap) {
      return buildRecommendation(cheap, candidates, estInput, estOutput, taskType, capStatus, diagnostics,
        `Bumped from '${top.id}' to '${cheap.id}' because maxUsdPerCall=${hints.maxUsdPerCall} (orig estimate $${est.toFixed(4)}).`);
    }
    // No cheap-enough candidate — still return top with explicit diagnostic
    diagnostics.max_usd_per_call = `orig top '${top.id}' estimate $${est.toFixed(4)} > limit ${hints.maxUsdPerCall} — no cheaper fit`;
  }

  return buildRecommendation(top, candidates, estInput, estOutput, taskType, capStatus, diagnostics);
}

function buildRecommendation(
  top: ModelEntry,
  sorted: ModelEntry[],
  estInput: number,
  estOutput: number,
  taskType: TaskType,
  capStatus: CostCapStatus,
  diagnostics: Record<string, string>,
  overrideReason?: string,
): ModelRecommendation {
  const est = estimateCost(top, estInput, estOutput);
  const alternatives = sorted.filter(m => m.id !== top.id).slice(0, 3).map(m => m.id);
  const reasoning = overrideReason ?? describeReasoning(top, taskType, est, capStatus);
  return {
    recommended: top.id,
    alternatives,
    reasoning,
    estimatedCostUsd: round4(est),
    diagnostics,
    capStatus,
  };
}

export function estimateCost(model: ModelEntry, estInputTokens: number, estOutputTokens: number): number {
  if (model.local) return 0;
  const input = (estInputTokens / 1_000_000) * model.inputPerMtok;
  const output = (estOutputTokens / 1_000_000) * model.outputPerMtok;
  return input + output;
}

function describeReasoning(model: ModelEntry, taskType: TaskType, estUsd: number, capStatus: CostCapStatus): string {
  const parts: string[] = [
    `Task '${taskType}' fits ${model.id} (${model.provider}${model.local ? ', local' : ''}).`,
    `Estimated cost: ${model.local ? 'free (local)' : '$' + estUsd.toFixed(4)}.`,
  ];
  if (capStatus !== 'ok') parts.push(`Cap status: ${capStatus}.`);
  if (model.local) parts.push(`Local preferred (RAM ≥ ${model.minRamGb ?? 0} GB).`);
  return parts.join(' ');
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
