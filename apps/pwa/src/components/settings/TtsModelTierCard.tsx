'use client';

// M2-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// TTS quality tier slider settings card.
//
// Same 5-tick pattern as STT/LLM. Ladder:
//   Budget   = macOS say        (offline · $0/char)
//   Balanced = openai-tts       ($15/M chars)
//   Better   = openai-tts-hd    ($30/M chars)
//   Best     = elevenlabs flash ($20/M chars · 75ms · 32 langs)
//   Loaded   = elevenlabs multilingual v2 ($20/M chars · long-form)
//
// Voice ID picker (M2-2b) is orthogonal — this card only controls the
// *model* (quality / latency / language coverage), not the voice
// identity. Per-character cost projection requires a typical-day char
// estimate; until the cost-tracker subscriber lands, the card shows a
// per-million-chars rate instead of a live monthly figure.

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  DEFAULT_MODEL_TIER,
  MODEL_TIERS,
  MODEL_TIER_LABELS,
  TTS_TIER_MAP,
  modelTierRank,
  projectTtsMonthlyCost,
  type ModelTier,
} from '@/lib/model-tier-spec';
import {
  activeTtsTier,
  loadModelTierPrefs,
  saveModelTierPrefs,
  type ModelTierPrefs,
} from '@/lib/model-tier-prefs';
import {
  hydrateFromDaemon,
  pushTtsTierToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from '@/lib/model-tier-sync';

const TICK_COUNT = MODEL_TIERS.length;

function tierAtIndex(index: number): ModelTier {
  const clamped = Math.max(0, Math.min(TICK_COUNT - 1, Math.round(index)));
  return MODEL_TIERS[clamped] as ModelTier;
}

function formatRatePerMillion(usdPerChar: number): string {
  if (!Number.isFinite(usdPerChar) || usdPerChar <= 0) return 'free';
  return `$${(usdPerChar * 1_000_000).toFixed(0)}/M chars`;
}

export function TtsModelTierCard(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);

  const [prefs, setPrefs] = useState<ModelTierPrefs>(loadModelTierPrefs);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

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

  const active = activeTtsTier(prefs);
  const activeSpec = TTS_TIER_MAP[active];
  const usingDefault = prefs.tts === undefined;
  const rank = modelTierRank(active);

  const commitTier = (tier: ModelTier) => {
    const next = saveModelTierPrefs({ tts: tier });
    setPrefs(next);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.tts.update', { tts: tier });
    void pushTtsTierToDaemon(httpCfg, tier).then(setSyncStatus);
  };

  const onSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const tier = tierAtIndex(Number(event.target.value));
    if (tier === active) return;
    commitTier(tier);
  };

  const onReset = () => {
    const next = saveModelTierPrefs({ tts: undefined as unknown as ModelTier });
    setPrefs(next);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.tts.reset');
    void pushTtsTierToDaemon(httpCfg, null).then(setSyncStatus);
  };

  // Phase 2: cost preview uses a "100 chars/day" typical-user heuristic
  // until the TTS cost-tracker subscriber feeds the daily char estimate.
  // Surfacing the per-million rate keeps the trade-off visible today.
  const rateLabel = formatRatePerMillion(activeSpec.usdPerCharacter);

  return (
    <section
      data-testid="tts-model-tier-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">🔊 Voice playback quality</h3>
        <p className="text-xs text-muted-foreground">
          Pick text-to-speech quality vs. cost. Voice identity (Rachel · SoYoung ·
          custom) lives in a separate picker (Phase 2 M2-2b).
        </p>
      </header>

      <div className="space-y-3">
        <div className="rounded-md border border-input bg-background px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">
              {MODEL_TIER_LABELS[active]}
              {usingDefault && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" data-testid="tts-model-tier-default-badge">
                  Smart default
                </span>
              )}
              {syncStatus === 'syncing' && (
                <span className="ml-2 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600" data-testid="tts-model-tier-sync-status">
                  Syncing…
                </span>
              )}
              {syncStatus === 'synced' && (
                <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600" data-testid="tts-model-tier-sync-status">
                  Synced
                </span>
              )}
              {syncStatus === 'offline' && (
                <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600" data-testid="tts-model-tier-sync-status">
                  Offline
                </span>
              )}
              {syncStatus === 'error' && (
                <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600" data-testid="tts-model-tier-sync-status">
                  Sync error
                </span>
              )}
            </span>
            <span
              className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]"
              data-testid="tts-model-tier-rate"
            >
              {rateLabel}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={TICK_COUNT - 1}
            step={1}
            value={rank}
            onChange={onSliderChange}
            data-testid="tts-model-tier-slider"
            aria-label="Voice playback tier"
            aria-valuemin={0}
            aria-valuemax={TICK_COUNT - 1}
            aria-valuenow={rank}
            aria-valuetext={MODEL_TIER_LABELS[active]}
            className="w-full"
          />

          <div
            className="mt-1 flex justify-between text-[10px] text-muted-foreground"
            data-testid="tts-model-tier-tick-labels"
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
            data-testid="tts-model-tier-rationale"
          >
            {activeSpec.rationale}
          </p>

          <p
            className="mt-1 text-[10px] text-muted-foreground/80"
            data-testid="tts-model-tier-model-id"
          >
            Provider: <span className="font-mono">{activeSpec.provider}</span>
            <span className="ml-1">·</span>
            <span className="ml-1">Model: <span className="font-mono">{activeSpec.model}</span></span>
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={usingDefault}
          className="text-xs text-muted-foreground"
          data-testid="tts-model-tier-reset"
        >
          Reset to default ({MODEL_TIER_LABELS[DEFAULT_MODEL_TIER]})
        </Button>
      </div>
    </section>
  );
}

// Re-export so future Phase-3 BudgetGuard can pull the projection
// helper without taking a transitive dep on the card module.
export { projectTtsMonthlyCost };
