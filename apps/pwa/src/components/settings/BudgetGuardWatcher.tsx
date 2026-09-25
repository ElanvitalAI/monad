'use client';

// M3-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Mounting wrapper around BudgetThresholdModal.
//
// Polls `GET /v1/budget/status` every `pollMs` (default 60s) while the
// daemon is reachable, decides via `shouldShowBudgetModal` whether to
// surface the modal, and hands the "Switch" / "Local-only" choice to
// `applyBudgetFallback` (which fans the recommended tier out to STT /
// LLM / TTS). "Continue" + Escape persist a same-month-and-status
// dismissal in localStorage so we don't re-nag on the next tick.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDaemon } from '@/components/providers/DaemonProvider';
import {
  applyBudgetFallback,
  dismissBudget,
  fetchBudgetStatus,
  shouldShowBudgetModal,
  type BudgetStatusBody,
} from '@/lib/budget-status';
import { BudgetThresholdModal, type BudgetThresholdChoice } from './BudgetThresholdModal';
import type { ModelTier } from '@/lib/model-tier-spec';

export interface BudgetGuardWatcherProps {
  /** Override the 60s poll cadence — primarily a test seam. Passing 0
   *  disables polling (modal only fires on initial mount). */
  pollMs?: number;
  /** Navigate the user to the budget cap input. SettingsPanel passes a
   *  scrollTo handler; we keep this generic so the watcher can mount
   *  on any page. */
  onAdjustCap?: () => void;
}

const DEFAULT_POLL_MS = 60_000;

export function BudgetGuardWatcher(props: BudgetGuardWatcherProps): React.ReactNode {
  const { pollMs = DEFAULT_POLL_MS, onAdjustCap } = props;
  const { config } = useDaemon();
  const [status, setStatus] = useState<BudgetStatusBody | null>(null);

  // Poll the daemon. Re-establishes on baseUrl change so a host swap
  // doesn't keep hitting the wrong daemon.
  useEffect(() => {
    if (!config.baseUrl) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const body = await fetchBudgetStatus({
        baseUrl: config.baseUrl,
        ...(config.token ? { token: config.token } : {}),
      });
      if (cancelled) return;
      setStatus(body);
    };
    void tick();
    if (pollMs <= 0) return () => { cancelled = true; };
    const handle = setInterval(() => { void tick(); }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [config.baseUrl, config.token, pollMs]);

  const handleApply = useCallback(
    async (choice: BudgetThresholdChoice, tier: ModelTier): Promise<void> => {
      if (!status) return;
      if (choice === 'continue') {
        dismissBudget(status.monthYYYYMM, status.status === 'ok' ? 'warning' : status.status);
        setStatus({ ...status, status: 'ok' }); // local-state hide
        toast.message('Continuing at current tier — monad will nag again at next threshold.');
        return;
      }
      // Switch + Local-only both apply the recommended fallback today.
      // The "local-only" enforcement (provider floor) is a follow-up;
      // we still record the user's choice so analytics can split them.
      const result = await applyBudgetFallback(
        {
          baseUrl: config.baseUrl,
          ...(config.token ? { token: config.token } : {}),
        },
        tier,
      );
      if (result === 'synced') {
        toast.success(`Switched STT/LLM/TTS to ${tier}.`);
      } else if (result === 'offline') {
        toast.error('Daemon offline — change saved locally, will sync when online.');
      } else {
        toast.error(`Budget fallback failed: ${result}.`);
      }
      // Mark dismissed for this month+status so the modal doesn't
      // re-open on the next poll while the spend keeps climbing.
      dismissBudget(status.monthYYYYMM, status.status === 'ok' ? 'warning' : status.status);
      setStatus({ ...status, status: 'ok' });
    },
    [config.baseUrl, config.token, status],
  );

  const handleDismiss = useCallback((): void => {
    if (!status) return;
    dismissBudget(status.monthYYYYMM, status.status === 'ok' ? 'warning' : status.status);
    setStatus({ ...status, status: 'ok' });
  }, [status]);

  const handleAdjustCap = useCallback((): void => {
    if (onAdjustCap) onAdjustCap();
    handleDismiss();
  }, [onAdjustCap, handleDismiss]);

  if (!status || !shouldShowBudgetModal(status)) return null;
  // shouldShowBudgetModal already gates on status ≠ 'ok' + fallback exists.
  return (
    <BudgetThresholdModal
      status={status.status as Exclude<BudgetStatusBody['status'], 'ok'>}
      percent={status.percent ?? 0}
      monthlyUsdCap={status.monthlyUsdCap ?? 0}
      monthSoFarUsd={status.monthSoFarUsd}
      recommendedFallback={status.recommendedFallback!}
      notifyAtPct={status.notifyAtPct}
      onApply={(choice, tier) => { void handleApply(choice, tier); }}
      onAdjustCap={handleAdjustCap}
      onDismiss={handleDismiss}
    />
  );
}
