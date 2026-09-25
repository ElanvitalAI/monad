'use client';

/** RFC #2161 Phase 3 (2026-05-11) — resolved view hook.
 *
 *  Phase 3 reads the static Layer A catalog (`GET /v1/registry/catalog`)
 *  and exposes a "resolved view": canonical provider list + canonical
 *  model list + provider-aware model filter helpers. Phase 5 swaps the
 *  underlying source for the Live Registry (apiKey availability + health
 *  + rate-limit) while preserving the same hook signature so consumers
 *  (Showroom dropdown, future LlmCatalogCard) stay file-disjoint with
 *  the upgrade.
 *
 *  Mirrors the `usePersonas(client)` pattern: takes a `DaemonClient`
 *  prop, caches the response per process so re-mounts in the same tab
 *  don't re-hit the daemon, surfaces loading + error states. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DaemonClient } from '../daemon-client';

export interface ResolvedProviderEntry {
  id: string;
  displayName: string;
  aliases: readonly string[];
  modelPrefixes: readonly string[];
  apiKeyEnv: string;
  endpointPattern: string;
  capabilities: Readonly<Record<string, boolean>>;
  builtIn: boolean;
}

export interface ResolvedModelEntry {
  id: string;
  provider: string;
  displayName: string;
  family?: string;
  familyShortcut?: string;
  contextSize?: number;
  outputMaxTokens?: number;
  vision?: 'images' | 'video' | 'pdf' | null;
  reasoning?: 'off' | 'low' | 'medium' | 'high' | null;
  toolCalling?:
    | 'native-anthropic'
    | 'native-openai'
    | 'native-gemini'
    | 'none';
  pricing?: {
    inputPerMTok: number;
    outputPerMTok: number;
    cachedInputPerMTok?: number;
  };
  deprecated?: string | null;
  releaseDate?: string;
  kind?: 'chat' | 'embedding' | 'image' | 'audio';
}

export interface UseResolvedViewResult {
  /** Canonical provider list (sorted by id). Empty while loading. */
  providers: readonly ResolvedProviderEntry[];
  /** Canonical provider ids only — convenient for dropdown options. */
  providerIds: readonly string[];
  /** All catalog models (sorted by provider then id). */
  models: readonly ResolvedModelEntry[];
  /** Models filtered to the given canonical provider id. Returns the
   *  full list when `providerId` is empty. Phase 5 layers apiKey-
   *  availability filtering on top. */
  modelsByProvider(providerId: string): readonly ResolvedModelEntry[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Module-level cache shared across components in the same tab. The
 *  catalog only changes when the daemon restarts, so a 5-minute TTL is
 *  comfortable. Phase 5's SSE-driven invalidation will replace this. */
const TTL_MS = 5 * 60_000;
let _cache: {
  at: number;
  providers: ResolvedProviderEntry[];
  models: ResolvedModelEntry[];
} | null = null;

const EMPTY_PROVIDERS: readonly ResolvedProviderEntry[] = [];
const EMPTY_MODELS: readonly ResolvedModelEntry[] = [];

export function useResolvedView(client: DaemonClient): UseResolvedViewResult {
  const [providers, setProviders] = useState<readonly ResolvedProviderEntry[]>(
    () => (_cache && Date.now() - _cache.at < TTL_MS ? _cache.providers : EMPTY_PROVIDERS),
  );
  const [models, setModels] = useState<readonly ResolvedModelEntry[]>(
    () => (_cache && Date.now() - _cache.at < TTL_MS ? _cache.models : EMPTY_MODELS),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.getRegistryCatalog();
      const provs: ResolvedProviderEntry[] = res.providers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        aliases: p.aliases,
        modelPrefixes: p.modelPrefixes,
        apiKeyEnv: p.apiKeyEnv,
        endpointPattern: p.endpointPattern,
        capabilities: p.capabilities,
        builtIn: p.builtIn,
      }));
      const mods: ResolvedModelEntry[] = res.models.map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        ...(m.family !== undefined ? { family: m.family } : {}),
        ...(m.familyShortcut !== undefined ? { familyShortcut: m.familyShortcut } : {}),
        ...(m.contextSize !== undefined ? { contextSize: m.contextSize } : {}),
        ...(m.outputMaxTokens !== undefined ? { outputMaxTokens: m.outputMaxTokens } : {}),
        ...(m.vision !== undefined ? { vision: m.vision } : {}),
        ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
        ...(m.toolCalling !== undefined ? { toolCalling: m.toolCalling } : {}),
        ...(m.pricing !== undefined ? { pricing: m.pricing } : {}),
        ...(m.deprecated !== undefined ? { deprecated: m.deprecated } : {}),
        ...(m.releaseDate !== undefined ? { releaseDate: m.releaseDate } : {}),
        ...(m.kind !== undefined ? { kind: m.kind } : {}),
      }));
      _cache = { at: Date.now(), providers: provs, models: mods };
      setProviders(provs);
      setModels(mods);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (_cache && Date.now() - _cache.at < TTL_MS) {
      setProviders(_cache.providers);
      setModels(_cache.models);
      return;
    }
    void fetchOnce();
  }, [fetchOnce]);

  const reload = useCallback(async () => {
    _cache = null;
    await fetchOnce();
  }, [fetchOnce]);

  const providerIds = useMemo(() => providers.map((p) => p.id), [providers]);

  const modelsByProvider = useMemo(() => {
    const byProvider = new Map<string, ResolvedModelEntry[]>();
    for (const m of models) {
      const list = byProvider.get(m.provider);
      if (list) list.push(m);
      else byProvider.set(m.provider, [m]);
    }
    return (providerId: string): readonly ResolvedModelEntry[] => {
      if (!providerId) return models;
      return byProvider.get(providerId) ?? [];
    };
  }, [models]);

  return {
    providers,
    providerIds,
    models,
    modelsByProvider,
    loading,
    error,
    reload,
  };
}

/** Test-only — clear the module-level cache between test cases. */
export function __resetResolvedViewCacheForTests(): void {
  _cache = null;
}
