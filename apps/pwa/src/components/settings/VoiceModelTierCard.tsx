'use client';

// M1-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// Voice transcription tier slider settings card.
//
// 5-tick 1-D slider (Budget · Balanced · Better · Best · Loaded) backed
// by `model-tier-prefs.ts`. The slider abstracts away model IDs — the
// user expresses intent ("more accurate / cheaper / faster") and the
// resolver picks the model. The active tier's model id is still surfaced
// as a small footnote so power users can confirm.
//
// MVP scope:
//   - Local persistence (localStorage). Daemon cross-device sync lands
//     in M1-2b once NEXUS gains a root-level user-config write endpoint.
//   - Cost preview tooltip reads `audioMinPerDay` from prefs; the cost
//     subscriber (Phase 1 follow-up) keeps it fresh.
//   - Reset button clears the override so the card falls back to
//     "Smart default (Balanced)".

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  hydrateFromDaemon,
  pushSttTierToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from '@/lib/model-tier-sync';
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  MODEL_TIER_LABELS,
  STT_TIER_MAP,
  formatMonthlyUsd,
  modelTierRank,
  projectSttMonthlyCost,
  type ModelTier,
} from '@/lib/model-tier-spec';
import {
  activeSttTier,
  loadModelTierPrefs,
  resetModelTierPrefs,
  saveModelTierPrefs,
  type ModelTierPrefs,
} from '@/lib/model-tier-prefs';
import {
  TierChangeConfirmModal,
  shouldConfirmTierChange,
} from './TierChangeConfirmModal';

const TICK_COUNT = MODEL_TIERS.length;

function tierAtIndex(index: number): ModelTier {
  const clamped = Math.max(0, Math.min(TICK_COUNT - 1, Math.round(index)));
  return MODEL_TIERS[clamped] as ModelTier;
}

export function VoiceModelTierCard(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);
  const [prefs, setPrefs] = useState<ModelTierPrefs>(loadModelTierPrefs);
  const [pendingTier, setPendingTier] = useState<ModelTier | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  // M1-3 month-so-far is currently derived from voice-cost-events.jsonl
  // by the daemon — once we surface a /v1/voice/month-summary endpoint
  // this can hydrate from there. For now the modal's projected-vs-
  // projected delta is the main friction reducer.
  const [monthSoFarUsd] = useState<number>(0);

  // M1-2b — pull the daemon state once on mount so the slider reflects
  // the cross-device choice. localStorage stays the source of truth
  // when daemon unreachable. Re-hydrate is opportunistic; if it fails
  // we silently fall back to the local read above.
  useEffect(() => {
    setPrefs(loadModelTierPrefs());
    let cancelled = false;
    void (async () => {
      const merged = await hydrateFromDaemon(httpCfg);
      if (cancelled || !merged) return;
      setPrefs(merged);
      setSyncStatus('synced');
    })();
    return () => { cancelled = true; };
  }, [httpCfg]);

  const active = activeSttTier(prefs);
  const activeSpec = STT_TIER_MAP[active];
  const usingDefault = prefs.stt === undefined;
  // While the confirm modal is open the slider visualizes the *pending*
  // position so the user sees their drag reflected; cancel snaps back.
  const visibleTier = pendingTier ?? active;
  const rank = modelTierRank(visibleTier);

  // Pre-compute every tier's monthly cost so the slider tooltip can
  // show "$X/mo at the new tier" the instant the user drags. Costs
  // are derived from the user's recent daily-average audio minutes.
  const monthlyCostByTier = useMemo(() => {
    const out: Record<ModelTier, number> = {} as Record<ModelTier, number>;
    for (const tier of MODEL_TIERS) {
      out[tier] = projectSttMonthlyCost(tier, prefs.audioMinPerDay);
    }
    return out;
  }, [prefs.audioMinPerDay]);

  const commitTier = (tier: ModelTier) => {
    const next = saveModelTierPrefs({ stt: tier });
    setPrefs(next);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.update', { stt: tier });
    // Optimistic UI — daemon PUT is fire-and-forget; the helper still
    // hits localStorage first, so a failed sync doesn't lose the user
    // intent.
    void pushSttTierToDaemon(httpCfg, tier).then(setSyncStatus);
  };

  const onSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const tier = tierAtIndex(Number(event.target.value));
    if (tier === active) return;
    // Decide whether the change is friction-worthy (upgrade past
    // threshold or no-usage drastic rate jump). Downgrades are silent.
    const needsConfirm = shouldConfirmTierChange({
      currentTier: active,
      nextTier: tier,
      currentTierMonthlyUsd: monthlyCostByTier[active],
      nextTierMonthlyUsd: monthlyCostByTier[tier],
      audioMinPerDay: prefs.audioMinPerDay,
    });
    if (needsConfirm) {
      setPendingTier(tier);
      return;
    }
    commitTier(tier);
  };

  const onConfirmTier = () => {
    if (pendingTier) commitTier(pendingTier);
    setPendingTier(null);
  };

  const onCancelTier = () => {
    setPendingTier(null);
    debugLog('settings.model-tier.cancel', { from: active });
  };

  const onReset = () => {
    setPrefs(resetModelTierPrefs());
    setPendingTier(null);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.reset');
    void pushSttTierToDaemon(httpCfg, null).then(setSyncStatus);
  };

  return (
    <section
      data-testid="voice-model-tier-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">🎚️ Voice transcription quality</h3>
        <p className="text-xs text-muted-foreground">
          Pick how accurate vs. cheap the speech-to-text should be — elanous picks
          the model. Switching takes effect on the next voice call.
        </p>
      </header>

      <div className="space-y-3">
        <div className="rounded-md border border-input bg-background px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">
              {MODEL_TIER_LABELS[active]}
              {usingDefault && (
                <span
                  className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  data-testid="voice-model-tier-default-badge"
                >
                  Smart default
                </span>
              )}
              {syncStatus === 'syncing' && (
                <span
                  className="ml-2 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600"
                  data-testid="voice-model-tier-sync-status"
                >
                  Syncing…
                </span>
              )}
              {syncStatus === 'synced' && (
                <span
                  className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600"
                  data-testid="voice-model-tier-sync-status"
                >
                  Synced
                </span>
              )}
              {syncStatus === 'offline' && (
                <span
                  className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600"
                  data-testid="voice-model-tier-sync-status"
                  title="Daemon unreachable — change saved locally · will sync when daemon comes back"
                >
                  Offline
                </span>
              )}
              {syncStatus === 'error' && (
                <span
                  className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600"
                  data-testid="voice-model-tier-sync-status"
                  title="Daemon refused the write — local copy still has your choice"
                >
                  Sync error
                </span>
              )}
            </span>
            <span
              className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]"
              data-testid="voice-model-tier-cost"
            >
              {prefs.audioMinPerDay > 0
                ? formatMonthlyUsd(monthlyCostByTier[active])
                : `${(activeSpec.usdPerMinAudio + activeSpec.loadedExtraUsdPerMin).toFixed(3)}/min`}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={TICK_COUNT - 1}
            step={1}
            value={rank}
            onChange={onSliderChange}
            data-testid="voice-model-tier-slider"
            aria-label="Voice transcription tier"
            aria-valuemin={0}
            aria-valuemax={TICK_COUNT - 1}
            aria-valuenow={rank}
            aria-valuetext={MODEL_TIER_LABELS[active]}
            className="w-full"
          />

          <div
            className="mt-1 flex justify-between text-[10px] text-muted-foreground"
            data-testid="voice-model-tier-tick-labels"
          >
            {MODEL_TIERS.map((tier) => (
              <span
                key={tier}
                className={tier === active ? 'font-semibold text-foreground' : undefined}
              >
                {MODEL_TIER_LABELS[tier]}
              </span>
            ))}
          </div>

          <p
            className="mt-2 text-[11px] text-muted-foreground"
            data-testid="voice-model-tier-rationale"
          >
            {activeSpec.rationale}
          </p>

          <p
            className="mt-1 text-[10px] text-muted-foreground/80"
            data-testid="voice-model-tier-model-id"
          >
            Model: <span className="font-mono">{activeSpec.model}</span>
            {activeSpec.status === 'wip' && (
              <span className="ml-1 rounded bg-amber-500/10 px-1 py-0.5 text-amber-600">
                WIP · install local binary first
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={usingDefault}
          className="text-xs text-muted-foreground"
          data-testid="voice-model-tier-reset"
        >
          Reset to default ({MODEL_TIER_LABELS[DEFAULT_MODEL_TIER]})
        </Button>
        {prefs.audioMinPerDay > 0 && (
          <span
            className="text-[10px] text-muted-foreground"
            data-testid="voice-model-tier-usage-hint"
          >
            ~{prefs.audioMinPerDay.toFixed(0)} min/day · 14-day rolling avg
          </span>
        )}
      </div>

      {/* M1-3 — pre-switch cost preview modal. Mounts only when the
          slider triggers a friction-worthy upgrade (`shouldConfirmTierChange`
          policy). Downgrades and within-threshold deltas commit silently. */}
      {pendingTier && (
        <TierChangeConfirmModal
          currentTier={active}
          nextTier={pendingTier}
          currentTierMonthlyUsd={monthlyCostByTier[active]}
          nextTierMonthlyUsd={monthlyCostByTier[pendingTier]}
          monthSoFarUsd={monthSoFarUsd}
          onConfirm={onConfirmTier}
          onCancel={onCancelTier}
        />
      )}
    </section>
  );
}
