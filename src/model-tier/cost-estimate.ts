// M1-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Tier cost projection from recent usage samples.
//
// The slider/CLI/PWA needs to answer "what would switching to this tier
// cost me per month?" — translating the abstract tick into a concrete
// dollar figure is the central friction-reducer (PLAN §3.5 "live cost
// preview"). This module computes the projection without depending on
// cost-tracker internals so it stays unit-testable.
//
// Strategy:
//   1. Filter samples to the configured window (default 14 days · M3).
//   2. Compute daily-average audio minutes from STT samples.
//   3. Project monthly = daily-avg × 30 × tier $/min.
//
// Empty window → monthlyUsd = 0 (no projection). Callers (slider hover
// tooltip etc.) should display "no usage yet" instead of "$0/mo".

import { STT_TIER_MAP, sttTierEffectiveUsdPerMin } from './tier-map.js';
import type { ModelTier, ModelTierSurface } from './types.js';

// ── Sample shape ───────────────────────────────────────────────────

/** One usage event, recorded by cost-tracker. */
export interface UsageSample {
  surface: ModelTierSurface;
  /** Audio minutes (STT only). Optional so LLM/TTS samples don't need it. */
  audioMinutes?: number;
  /** Token count (LLM · Phase 2 placeholder). */
  tokens?: number;
  /** Character count (TTS · Phase 2 placeholder). */
  chars?: number;
  /** Cost actually billed for the sample. Tracked alongside the
   *  inputs so future estimators can compute calibration drift. */
  usd: number;
  /** Epoch ms. */
  at: number;
}

// ── Estimator inputs / outputs ─────────────────────────────────────

export interface CostEstimateInputs {
  /** Recent samples — order doesn't matter; the function filters by `at`. */
  samples: readonly UsageSample[];
  /** Lookback window in days. Default 14 (decision M3). */
  windowDays?: number;
  /** Reference time (epoch ms). Default `Date.now()` — injectable for tests. */
  now?: number;
}

export interface SttCostEstimate {
  /** Daily-average audio minutes inside the window. */
  audioMinPerDay: number;
  /** 30-day projected USD at the requested tier (base + loaded surcharge). */
  monthlyUsd: number;
  /** Window in days the projection was derived from. */
  windowDays: number;
  /** STT samples that fell inside the window. */
  sampleCount: number;
}

const DEFAULT_WINDOW_DAYS = 14;
const DAYS_PER_MONTH = 30;
const MS_PER_DAY = 86_400_000;

// ── STT projection ─────────────────────────────────────────────────

/** Project the monthly USD cost of running STT at `tier` given recent
 *  usage samples. Pure function; no IO. */
export function projectSttTierMonthlyCost(
  tier: ModelTier,
  inputs: CostEstimateInputs,
): SttCostEstimate {
  const now = inputs.now ?? Date.now();
  const windowDays = inputs.windowDays ?? DEFAULT_WINDOW_DAYS;
  const cutoff = now - windowDays * MS_PER_DAY;

  let totalAudioMin = 0;
  let sampleCount = 0;
  for (const s of inputs.samples) {
    if (s.surface !== 'stt') continue;
    if (s.at < cutoff || s.at > now) continue;
    const min = s.audioMinutes ?? 0;
    if (min <= 0) continue;
    totalAudioMin += min;
    sampleCount += 1;
  }

  const audioMinPerDay = sampleCount === 0 ? 0 : totalAudioMin / windowDays;
  const ratePerMin = sttTierEffectiveUsdPerMin(tier);
  const monthlyUsd = audioMinPerDay * DAYS_PER_MONTH * ratePerMin;
  return { audioMinPerDay, monthlyUsd, windowDays, sampleCount };
}

/** Compare projections across every tier — used by the slider tooltip
 *  ("$1 → $24/mo" delta) and by `monad voice status` to surface the
 *  cheapest alternative. Returns one estimate per tier. */
export function projectSttAllTiers(
  inputs: CostEstimateInputs,
): Readonly<Record<ModelTier, SttCostEstimate>> {
  const out: Partial<Record<ModelTier, SttCostEstimate>> = {};
  for (const tier of Object.keys(STT_TIER_MAP) as ModelTier[]) {
    out[tier] = projectSttTierMonthlyCost(tier, inputs);
  }
  return out as Record<ModelTier, SttCostEstimate>;
}
