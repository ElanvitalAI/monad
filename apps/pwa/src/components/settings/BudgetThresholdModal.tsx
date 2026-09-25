'use client';

// M3-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Budget threshold modal (pillar 4 · §3.4 + §4.4).
//
// Mounted by SettingsPanel via the BudgetGuardWatcher hook · displays
// when `GET /v1/budget/status` returns `warning` or `cap-exceeded`. UX
// follows the §4.4 spec verbatim — 3 radio options with the
// recommended fallback pre-selected.
//
//   💰 You've used $40 of $50 monthly cap (80%)
//   ◉ Switch to <fallback> tier for the rest of this month
//   ○ Continue at current tier (may exceed cap)
//   ○ Use local-only models (cost = $0)
//   [Apply]  [Adjust cap]
//
// "Local-only" in v1 maps to the same fallback tier as "Switch" — true
// local-only enforcement (`provider = local-only` floor) lands as a
// follow-up once the tier-resolver gets a hard-floor flag. The radio
// option is preserved so the spec is matched at the surface level.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  MODEL_TIER_LABELS,
  formatMonthlyUsd,
  type ModelTier,
} from '@/lib/model-tier-spec';
import type { BudgetStatus } from '@/lib/budget-status';

export type BudgetThresholdChoice = 'switch' | 'continue' | 'local-only';

export interface BudgetThresholdModalProps {
  status: Exclude<BudgetStatus, 'ok'>;
  /** Already-rounded percent (0..999) — daemon-provided. */
  percent: number;
  monthlyUsdCap: number;
  monthSoFarUsd: number;
  /** Pre-selected fallback tier ('budget' by default, see §3.4 M7). */
  recommendedFallback: ModelTier;
  notifyAtPct: number;
  /** Called with the user's chosen radio + selected fallback (the
   *  "Switch" / "Local-only" both use the recommended tier today). */
  onApply: (choice: BudgetThresholdChoice, tier: ModelTier) => void;
  onAdjustCap: () => void;
  onDismiss: () => void;
}

export function BudgetThresholdModal(props: BudgetThresholdModalProps): React.ReactNode {
  const {
    status,
    percent,
    monthlyUsdCap,
    monthSoFarUsd,
    recommendedFallback,
    notifyAtPct,
    onApply,
    onAdjustCap,
    onDismiss,
  } = props;

  const [choice, setChoice] = useState<BudgetThresholdChoice>('switch');
  const applyRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    applyRef.current?.focus();
  }, []);

  const isExceeded = status === 'cap-exceeded';
  const fallbackLabel = MODEL_TIER_LABELS[recommendedFallback];
  const monthSoFarLabel = formatMonthlyUsd(monthSoFarUsd).replace('/mo', '');
  const capLabel = formatMonthlyUsd(monthlyUsdCap).replace('/mo', '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-threshold-title"
      aria-describedby="budget-threshold-summary"
      data-testid="budget-threshold-modal"
      data-status={status}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div
        className={`w-full max-w-md rounded-lg border bg-white p-4 shadow-xl dark:bg-zinc-900 ${
          isExceeded
            ? 'border-rose-300 dark:border-rose-700'
            : 'border-amber-300 dark:border-amber-700'
        }`}
      >
        <h2
          id="budget-threshold-title"
          className={`mb-2 text-sm font-medium ${
            isExceeded
              ? 'text-rose-700 dark:text-rose-300'
              : 'text-amber-700 dark:text-amber-300'
          }`}
        >
          💰 You've used {monthSoFarLabel} of {capLabel} monthly cap ({Math.round(percent)}%)
        </h2>

        <p
          id="budget-threshold-summary"
          className="mb-3 text-xs text-zinc-600 dark:text-zinc-400"
          data-testid="budget-threshold-summary"
        >
          {isExceeded
            ? `You've passed the cap. monad recommends falling back to ${fallbackLabel} tier for the rest of this month.`
            : `You're past the ${notifyAtPct}% threshold. monad can switch to ${fallbackLabel} tier to slow the burn.`}
        </p>

        <fieldset
          className="mb-4 space-y-1.5 text-xs"
          data-testid="budget-threshold-choices"
        >
          <legend className="sr-only">Auto-fallback options</legend>
          <RadioRow
            id="switch"
            label={`Switch to ${fallbackLabel} tier for the rest of this month`}
            checked={choice === 'switch'}
            onSelect={() => setChoice('switch')}
          />
          <RadioRow
            id="continue"
            label="Continue at current tier (may exceed cap)"
            checked={choice === 'continue'}
            onSelect={() => setChoice('continue')}
          />
          <RadioRow
            id="local-only"
            label="Use local-only models (cost = $0)"
            checked={choice === 'local-only'}
            onSelect={() => setChoice('local-only')}
          />
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAdjustCap}
            data-testid="budget-threshold-adjust-cap"
          >
            Adjust cap
          </Button>
          <Button
            ref={applyRef}
            type="button"
            size="sm"
            onClick={() => onApply(choice, recommendedFallback)}
            data-testid="budget-threshold-apply"
            className={
              isExceeded
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-amber-600 text-white hover:bg-amber-700'
            }
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

function RadioRow(props: {
  id: BudgetThresholdChoice;
  label: string;
  checked: boolean;
  onSelect: () => void;
}): React.ReactNode {
  const { id, label, checked, onSelect } = props;
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${
        checked
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
      data-testid={`budget-threshold-choice-${id}`}
    >
      <input
        type="radio"
        name="budget-threshold-choice"
        value={id}
        checked={checked}
        onChange={onSelect}
        className="h-3 w-3"
      />
      <span className="text-zinc-700 dark:text-zinc-200">{label}</span>
    </label>
  );
}
