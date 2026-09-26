'use client';

// M2-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Use-case preset card grid.
//
// 5 cards (Casual chat · Meeting notes · Medical dictation · Live
// caption · Sleep mode). 1-click applies the preset's STT/LLM/TTS
// tiers (and optionally voice id + budget cap) in a single daemon
// PUT. Subsequent slider drags can still fine-tune from the preset's
// starting point.
//
// "Active preset" banner shows when modelTier.preset is set so the
// user can see at a glance which bundle is current.

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import { PRESETS, PRESET_IDS, type PresetId, type PresetSpec } from '@/lib/preset-catalog';
import {
  pushPresetToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from '@/lib/model-tier-sync';

const STORAGE_KEY = 'elanous.active-preset';

function loadActivePreset(): PresetId | undefined {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return PRESET_IDS.includes(raw as PresetId) ? (raw as PresetId) : undefined;
  } catch { return undefined; }
}

function saveActivePreset(id: PresetId | null): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch { /* ignore */ }
}

export function PresetCardGrid(): React.ReactNode {
  const { config } = useDaemon();
  const httpCfg: DaemonHttpConfig = useMemo(() => ({
    baseUrl: config.baseUrl,
    ...(config.token ? { token: config.token } : {}),
  }), [config.baseUrl, config.token]);

  const [activePreset, setActivePreset] = useState<PresetId | undefined>(
    loadActivePreset,
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [busy, setBusy] = useState<PresetId | null>(null);

  useEffect(() => {
    setActivePreset(loadActivePreset());
  }, []);

  const applyPreset = async (spec: PresetSpec) => {
    setBusy(spec.id);
    setSyncStatus('syncing');
    debugLog('settings.preset.apply', { id: spec.id });
    saveActivePreset(spec.id);
    setActivePreset(spec.id);
    const status = await pushPresetToDaemon(httpCfg, {
      id: spec.id,
      tiers: spec.tiers,
      ...(spec.ttsVoice ? { ttsVoice: spec.ttsVoice } : {}),
      ...(spec.monthlyUsdCap !== undefined ? { monthlyUsdCap: spec.monthlyUsdCap } : {}),
    });
    setSyncStatus(status);
    setBusy(null);
  };

  const clearPreset = async () => {
    setSyncStatus('syncing');
    debugLog('settings.preset.clear');
    saveActivePreset(null);
    setActivePreset(undefined);
    const status = await pushPresetToDaemon(httpCfg, null);
    setSyncStatus(status);
  };

  return (
    <section
      data-testid="preset-card-grid"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">⚡ Quick presets</h3>
          <p className="text-xs text-muted-foreground">
            One-click bundles for common use cases — applies STT, LLM, TTS,
            voice id, and budget cap together. You can still fine-tune any
            slider after applying.
          </p>
        </div>
        {syncStatus === 'syncing' && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600" data-testid="preset-sync-status">
            Syncing…
          </span>
        )}
        {syncStatus === 'synced' && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600" data-testid="preset-sync-status">
            Synced
          </span>
        )}
        {syncStatus === 'offline' && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600" data-testid="preset-sync-status">
            Offline
          </span>
        )}
        {syncStatus === 'error' && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600" data-testid="preset-sync-status">
            Sync error
          </span>
        )}
      </header>

      {activePreset && (
        <div
          className="mb-3 flex items-center justify-between rounded bg-emerald-500/5 px-3 py-2 text-xs"
          data-testid="preset-active-banner"
        >
          <span className="text-emerald-700 dark:text-emerald-300">
            ✓ Active preset: <strong>{PRESETS[activePreset].label}</strong>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearPreset}
            className="text-[11px] text-muted-foreground"
            data-testid="preset-clear-active"
          >
            Clear preset
          </Button>
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="preset-card-list"
      >
        {PRESET_IDS.map((id) => {
          const spec = PRESETS[id];
          const isActive = activePreset === id;
          const isBusy = busy === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(spec)}
              disabled={isBusy}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-border/60 bg-background hover:bg-muted/40'
              }`}
              data-testid={`preset-card-${id}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {spec.icon} {spec.label}
                </span>
                {isActive && (
                  <span className="text-[10px] text-emerald-600">active</span>
                )}
                {isBusy && (
                  <span className="text-[10px] text-blue-600">applying…</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {spec.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-1 text-[9px] text-muted-foreground">
                {spec.tiers.stt && <span className="rounded bg-muted px-1 py-0.5 font-mono">stt:{spec.tiers.stt}</span>}
                {spec.tiers.llm && <span className="rounded bg-muted px-1 py-0.5 font-mono">llm:{spec.tiers.llm}</span>}
                {spec.tiers.tts && <span className="rounded bg-muted px-1 py-0.5 font-mono">tts:{spec.tiers.tts}</span>}
                {spec.monthlyUsdCap !== undefined && (
                  <span className="rounded bg-muted px-1 py-0.5 font-mono">cap:${spec.monthlyUsdCap}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
