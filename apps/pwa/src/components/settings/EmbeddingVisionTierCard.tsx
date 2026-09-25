'use client';

// M3-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Embedding + Vision tier settings card.
//
// Compact 5-tick selector for the two infrequently-touched model
// surfaces (embedding for RAG · vision for OCR / image analysis). Lives
// in one card so the settings page doesn't grow two more sliders that
// most casual users never visit.
//
// MVP UX: each surface gets a row of 5 buttons (Budget · Balanced ·
// Better · Best · Loaded). Click writes localStorage then PUTs the
// daemon. Cost ladders are surfaced as tooltips · the actual per-call
// cost preview lands when RAG/vision call sites start running through
// the resolver (deferred).

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  MODEL_TIERS,
  MODEL_TIER_LABELS,
  type ModelTier,
} from '@/lib/model-tier-spec';
import {
  activeEmbeddingTier,
  activeVisionTier,
  loadModelTierPrefs,
  type ModelTierPrefs,
} from '@/lib/model-tier-prefs';
import {
  hydrateFromDaemon,
  pushEmbeddingTierToDaemon,
  pushVisionTierToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from '@/lib/model-tier-sync';

const SURFACE_HINTS: Record<'embedding' | 'vision', string> = {
  embedding: 'RAG retrieval · similarity. Most users never touch this.',
  vision: 'OCR · screenshot analysis · note-from-image.',
};

export function EmbeddingVisionTierCard(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);

  const [prefs, setPrefs] = useState<ModelTierPrefs>(loadModelTierPrefs);
  const [embeddingSync, setEmbeddingSync] = useState<SyncStatus>('idle');
  const [visionSync, setVisionSync] = useState<SyncStatus>('idle');

  useEffect(() => {
    setPrefs(loadModelTierPrefs());
    let cancelled = false;
    void (async () => {
      const merged = await hydrateFromDaemon(httpCfg);
      if (cancelled || !merged) return;
      setPrefs(merged);
    })();
    return () => { cancelled = true; };
  }, [httpCfg]);

  const handleSelect = async (
    surface: 'embedding' | 'vision',
    tier: ModelTier,
  ): Promise<void> => {
    debugLog('pwa.settings.tier.embedding-vision', `selected ${surface}=${tier}`);
    if (surface === 'embedding') {
      setEmbeddingSync('syncing');
      const status = await pushEmbeddingTierToDaemon(httpCfg, tier);
      setEmbeddingSync(status);
      setPrefs((p) => ({ ...p, embedding: tier }));
    } else {
      setVisionSync('syncing');
      const status = await pushVisionTierToDaemon(httpCfg, tier);
      setVisionSync(status);
      setPrefs((p) => ({ ...p, vision: tier }));
    }
  };

  const renderRow = (surface: 'embedding' | 'vision') => {
    const active = surface === 'embedding' ? activeEmbeddingTier(prefs) : activeVisionTier(prefs);
    const explicit = surface === 'embedding' ? !!prefs.embedding : !!prefs.vision;
    const sync = surface === 'embedding' ? embeddingSync : visionSync;
    return (
      <div className="space-y-1.5" data-testid={`embedding-vision-row-${surface}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {surface === 'embedding' ? 'Embedding' : 'Vision'}
          </h3>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {explicit ? `Saved · ${sync}` : 'Smart default'}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {SURFACE_HINTS[surface]}
        </p>
        <div className="flex flex-wrap gap-1">
          {MODEL_TIERS.map((tier) => (
            <Button
              key={tier}
              size="sm"
              variant={tier === active ? 'default' : 'outline'}
              onClick={() => { void handleSelect(surface, tier); }}
              data-testid={`embedding-vision-${surface}-${tier}`}
              className="text-[11px]"
            >
              {MODEL_TIER_LABELS[tier]}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4" data-testid="embedding-vision-card">
      <header className="space-y-1">
        <h2 className="text-sm font-medium">Embedding · Vision tier</h2>
        <p className="text-xs text-muted-foreground">
          Phase 3 scaffolding — model selection for RAG embedding + image vision. Resolvers wired; call-site integration follows as RAG / vision pipelines come online.
        </p>
      </header>
      {renderRow('embedding')}
      {renderRow('vision')}
    </section>
  );
}
