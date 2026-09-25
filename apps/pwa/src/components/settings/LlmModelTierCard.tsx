'use client';

// M2-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// LLM tier slider settings card.
//
// Mirrors VoiceModelTierCard (M1-2) for the LLM surface. Same 5-tick
// abstraction (Budget · Balanced · Better · Best · Loaded) — the
// resolver consults the user's active provider (anthropic / openai /
// gemini / ...) and routes to the per-provider model on each rung.
//
// Per-token cost projection isn't wired yet (Phase 3 BudgetGuard).
// The card surfaces the per-tier model id + reasoning level + rationale
// so the trade-off is still visible even without a live monthly figure.

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  DEFAULT_MODEL_TIER,
  LLM_TIER_PROVIDER_LABELS,
  MODEL_TIERS,
  MODEL_TIER_LABELS,
  isLlmTierProvider,
  lookupLlmTierSpec,
  modelTierRank,
  type LlmTierProvider,
  type ModelTier,
} from '@/lib/model-tier-spec';
import {
  activeLlmTier,
  loadModelTierPrefs,
  saveModelTierPrefs,
  type ModelTierPrefs,
} from '@/lib/model-tier-prefs';
import {
  hydrateFromDaemon,
  pushLlmTierToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from '@/lib/model-tier-sync';

const TICK_COUNT = MODEL_TIERS.length;

function tierAtIndex(index: number): ModelTier {
  const clamped = Math.max(0, Math.min(TICK_COUNT - 1, Math.round(index)));
  return MODEL_TIERS[clamped] as ModelTier;
}

function resolveProvider(raw: unknown): LlmTierProvider {
  if (typeof raw === 'string' && isLlmTierProvider(raw)) return raw;
  // Auto / unknown → anthropic as the illustrative ladder, matches the
  // resolver's fallback. Real routing happens daemon-side.
  return 'anthropic';
}

export function LlmModelTierCard(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);

  const [prefs, setPrefs] = useState<ModelTierPrefs>(loadModelTierPrefs);
  const [provider, setProvider] = useState<LlmTierProvider>(
    () => resolveProvider(config.provider),
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  // Hydrate from daemon on mount · provider tracks config.provider as
  // the user flips between providers in settings.
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

  useEffect(() => {
    setProvider(resolveProvider(config.provider));
  }, [config.provider]);

  const active = activeLlmTier(prefs);
  const usingDefault = prefs.llm === undefined;
  const rank = modelTierRank(active);
  const activeSpec = lookupLlmTierSpec(provider, active);

  const commitTier = (tier: ModelTier) => {
    const next = saveModelTierPrefs({ llm: tier });
    setPrefs(next);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.llm.update', { llm: tier });
    void pushLlmTierToDaemon(httpCfg, tier).then(setSyncStatus);
  };

  const onSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const tier = tierAtIndex(Number(event.target.value));
    if (tier === active) return;
    // LLM has no usage-based cost preview yet (Phase 3 BudgetGuard
    // wires per-token tracking). The slider commits silently — when
    // BudgetGuard lands, the confirm modal will activate on big jumps.
    commitTier(tier);
  };

  const onReset = () => {
    const next = saveModelTierPrefs({ llm: undefined as unknown as ModelTier });
    setPrefs(next);
    setSyncStatus('syncing');
    debugLog('settings.model-tier.llm.reset');
    void pushLlmTierToDaemon(httpCfg, null).then(setSyncStatus);
  };

  return (
    <section
      data-testid="llm-model-tier-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold">🧠 AI assistant quality</h3>
        <p className="text-xs text-muted-foreground">
          Pick how careful vs. fast the model should think. monad chooses the
          right model on your active provider · the slider stays the same
          across providers.
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
                  data-testid="llm-model-tier-default-badge"
                >
                  Smart default
                </span>
              )}
              {syncStatus === 'syncing' && (
                <span className="ml-2 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600" data-testid="llm-model-tier-sync-status">
                  Syncing…
                </span>
              )}
              {syncStatus === 'synced' && (
                <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600" data-testid="llm-model-tier-sync-status">
                  Synced
                </span>
              )}
              {syncStatus === 'offline' && (
                <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600" data-testid="llm-model-tier-sync-status" title="Daemon unreachable">
                  Offline
                </span>
              )}
              {syncStatus === 'error' && (
                <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600" data-testid="llm-model-tier-sync-status" title="Daemon refused the write">
                  Sync error
                </span>
              )}
            </span>
            <span
              className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]"
              data-testid="llm-model-tier-provider"
            >
              {LLM_TIER_PROVIDER_LABELS[provider]}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={TICK_COUNT - 1}
            step={1}
            value={rank}
            onChange={onSliderChange}
            data-testid="llm-model-tier-slider"
            aria-label="AI assistant tier"
            aria-valuemin={0}
            aria-valuemax={TICK_COUNT - 1}
            aria-valuenow={rank}
            aria-valuetext={MODEL_TIER_LABELS[active]}
            className="w-full"
          />

          <div
            className="mt-1 flex justify-between text-[10px] text-muted-foreground"
            data-testid="llm-model-tier-tick-labels"
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
            data-testid="llm-model-tier-rationale"
          >
            {activeSpec.rationale}
          </p>

          <p
            className="mt-1 text-[10px] text-muted-foreground/80"
            data-testid="llm-model-tier-model-id"
          >
            Model: <span className="font-mono">{activeSpec.model}</span>
            {activeSpec.reasoningLevel && (
              <span className="ml-1 text-muted-foreground">
                · reasoning: <span className="font-mono">{activeSpec.reasoningLevel}</span>
              </span>
            )}
            {activeSpec.status === 'wip' && (
              <span className="ml-1 rounded bg-amber-500/10 px-1 py-0.5 text-amber-600">
                WIP · install local runtime first
              </span>
            )}
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
          data-testid="llm-model-tier-reset"
        >
          Reset to default ({MODEL_TIER_LABELS[DEFAULT_MODEL_TIER]})
        </Button>
      </div>
    </section>
  );
}
