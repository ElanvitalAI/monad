'use client';

// M1-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Pre-switch cost preview banner (modal flavor) for the STT tier
// slider.
//
// Surfaces three numbers before the user commits to a higher (or
// lower) tier so the trade-off is visible:
//
//   - Current month so far (read from cost-tracker)
//   - Projected full-month at the *current* tier (audioMinPerDay × rate × 30)
//   - Projected full-month at the *new* tier
//
// Mirrors the existing ShowroomCostGateModal shape (z-50 · aria-modal ·
// focus-trap to confirm). Cancel reverts the slider; confirm persists.
//
// PLAN §4.3 example UX (paraphrased):
//   ⚠️ You're switching to "Loaded" tier (gpt-realtime-whisper)
//   Current month so far: $4.20
//   Projected at current tier: $12
//   Projected at new tier:     $68
//
// Activation rule (in VoiceModelTierCard): show modal only when the
// new tier's projected monthly cost is meaningfully higher than the
// current tier's (configurable threshold). Downgrade slides are
// always silent — no friction to save money.

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  MODEL_TIER_LABELS,
  STT_TIER_MAP,
  formatMonthlyUsd,
  type ModelTier,
} from '@/lib/model-tier-spec';

export interface TierChangeConfirmModalProps {
  currentTier: ModelTier;
  nextTier: ModelTier;
  /** Projected monthly USD at the current tier (audioMinPerDay × 30 × rate). */
  currentTierMonthlyUsd: number;
  /** Projected monthly USD at the new tier. */
  nextTierMonthlyUsd: number;
  /** Actual USD billed so far this calendar month (from cost-tracker). */
  monthSoFarUsd: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TierChangeConfirmModal(props: TierChangeConfirmModalProps): React.ReactNode {
  const {
    currentTier,
    nextTier,
    currentTierMonthlyUsd,
    nextTierMonthlyUsd,
    monthSoFarUsd,
    onConfirm,
    onCancel,
  } = props;

  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const currentSpec = STT_TIER_MAP[currentTier];
  const nextSpec = STT_TIER_MAP[nextTier];
  const isUpgrade = nextTierMonthlyUsd > currentTierMonthlyUsd;
  const headerIcon = isUpgrade ? '⚠️' : '✓';
  const headerText = isUpgrade
    ? `Switch to "${MODEL_TIER_LABELS[nextTier]}" tier?`
    : `Switch to "${MODEL_TIER_LABELS[nextTier]}" tier (cheaper)`;
  const projectedDelta = nextTierMonthlyUsd - currentTierMonthlyUsd;
  const deltaLabel = projectedDelta >= 0
    ? `+${formatMonthlyUsd(Math.abs(projectedDelta))}`
    : `-${formatMonthlyUsd(Math.abs(projectedDelta))}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tier-confirm-title"
      aria-describedby="tier-confirm-summary"
      data-testid="tier-change-confirm-modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        className={`w-full max-w-md rounded-lg border bg-white p-4 shadow-xl dark:bg-zinc-900 ${
          isUpgrade
            ? 'border-amber-300 dark:border-amber-700'
            : 'border-emerald-300 dark:border-emerald-700'
        }`}
      >
        <h2
          id="tier-confirm-title"
          className={`mb-2 text-sm font-medium ${
            isUpgrade
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {headerIcon} {headerText}
        </h2>

        <p
          id="tier-confirm-summary"
          className="mb-3 text-xs text-zinc-700 dark:text-zinc-300"
        >
          {nextSpec.rationale}
        </p>

        <dl className="mb-4 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">Month so far</dt>
            <dd
              className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100"
              data-testid="tier-confirm-month-so-far"
            >
              {formatMonthlyUsd(monthSoFarUsd).replace('/mo', '')}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-zinc-500 dark:text-zinc-400">
              At current tier ({MODEL_TIER_LABELS[currentTier]})
            </dt>
            <dd
              className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100"
              data-testid="tier-confirm-current-projected"
            >
              {formatMonthlyUsd(currentTierMonthlyUsd)}
            </dd>
          </div>
          <div
            className={`flex items-center justify-between rounded px-2 py-1 ${
              isUpgrade ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40'
            }`}
          >
            <dt
              className={
                isUpgrade
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-emerald-700 dark:text-emerald-300'
              }
            >
              At new tier ({MODEL_TIER_LABELS[nextTier]})
            </dt>
            <dd
              className={`font-mono tabular-nums ${
                isUpgrade
                  ? 'text-amber-900 dark:text-amber-100'
                  : 'text-emerald-900 dark:text-emerald-100'
              }`}
              data-testid="tier-confirm-next-projected"
            >
              {formatMonthlyUsd(nextTierMonthlyUsd)}
              <span
                className="ml-1 text-[10px] opacity-70"
                data-testid="tier-confirm-delta"
              >
                ({deltaLabel})
              </span>
            </dd>
          </div>
        </dl>

        <p
          className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400"
          data-testid="tier-confirm-rate-line"
        >
          Per-call: ${currentSpec.usdPerMinAudio.toFixed(3)}/min → ${(nextSpec.usdPerMinAudio + nextSpec.loadedExtraUsdPerMin).toFixed(3)}/min
        </p>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid="tier-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            onClick={onConfirm}
            data-testid="tier-confirm-confirm"
            className={
              isUpgrade
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }
          >
            {isUpgrade ? 'Confirm switch' : 'Switch'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Activation policy (pure helper · tested) ───────────────────────

/** Threshold beyond which a tier upgrade triggers the confirm modal.
 *  Downgrades (negative delta) are always silent — no friction to save.
 *  $1/mo is the minimum cost increase that justifies a confirm step;
 *  smaller deltas feel like nagging.
 *
 *  Also fires when the user can't yet predict the cost (no usage data
 *  yet) AND the new tier's per-min rate is ≥5× the current — protects
 *  fresh users from a one-click slide to Loaded. */
export function shouldConfirmTierChange(opts: {
  currentTier: ModelTier;
  nextTier: ModelTier;
  currentTierMonthlyUsd: number;
  nextTierMonthlyUsd: number;
  audioMinPerDay: number;
}): boolean {
  const { currentTier, nextTier, currentTierMonthlyUsd, nextTierMonthlyUsd, audioMinPerDay } = opts;
  if (currentTier === nextTier) return false;
  const delta = nextTierMonthlyUsd - currentTierMonthlyUsd;

  // Downgrade is silent.
  if (delta < 0) return false;

  // Usage-projected branch — show modal if monthly delta ≥ $1.
  if (audioMinPerDay > 0) {
    return delta >= 1;
  }

  // No usage data yet — guard against drastic rate jumps.
  const currentRate = STT_TIER_MAP[currentTier].usdPerMinAudio + STT_TIER_MAP[currentTier].loadedExtraUsdPerMin;
  const nextRate = STT_TIER_MAP[nextTier].usdPerMinAudio + STT_TIER_MAP[nextTier].loadedExtraUsdPerMin;
  if (currentRate === 0) return nextRate > 0; // local → cloud
  return nextRate >= currentRate * 5;
}
