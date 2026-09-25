// RFC #2161 Phase 6 — Anthropic discovery source.
//
// Calls https://api.anthropic.com/v1/models with the standard
// `x-api-key` + `anthropic-version` headers and normalises the
// response into `DiscoveredModel[]`. Reuses the same auth + version
// constant pattern as the existing `src/nexus/api/llm-hosts.ts`
// dispatcher so the two surfaces don't diverge.

import type {
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 4000;
const ENDPOINT = 'https://api.anthropic.com/v1/models';

interface AnthropicModelWire {
  id?: string;
  type?: string;
  display_name?: string;
  created_at?: string;
}

export const anthropicSource: DiscoverySource = {
  id: 'anthropic',
  async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
    if (!apiKey) {
      return {
        source: 'anthropic',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: 'missing-api-key: ANTHROPIC_API_KEY env unset',
      };
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const externalAbort = opts.signal;
    const onExternalAbort = (): void => ac.abort();
    if (externalAbort) {
      if (externalAbort.aborted) ac.abort();
      else externalAbort.addEventListener('abort', onExternalAbort);
    }
    try {
      const res = await fetchImpl(ENDPOINT, {
        signal: ac.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
      });
      if (!res.ok) {
        const code = res.status;
        const detail = code === 401 || code === 403
          ? `upstream-auth-${code}`
          : `upstream-http-${code}`;
        return {
          source: 'anthropic',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: detail,
        };
      }
      const json = (await res.json().catch(() => null)) as
        | { data?: AnthropicModelWire[] } | null;
      const data = Array.isArray(json?.data) ? json!.data! : [];
      const lastSeen = new Date(now()).toISOString();
      const models = data
        .filter((m): m is AnthropicModelWire & { id: string } => typeof m?.id === 'string')
        .map((m) => ({
          id: m.id,
          provider: 'anthropic',
          partial: {
            id: m.id,
            provider: 'anthropic',
            displayName: m.display_name ?? m.id,
            ...(typeof m.created_at === 'string' ? { releaseDate: m.created_at.slice(0, 10) } : {}),
          },
          discoveryMeta: {
            source: 'auto-anthropic-api' as const,
            lastSeen,
            autoFilled: true,
            confidence: 'high' as const,
          },
        }));
      return {
        source: 'anthropic',
        ok: true,
        models,
        durationMs: now() - startedAt,
      };
    } catch (e) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'anthropic',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: aborted
          ? 'upstream-timeout'
          : `upstream-network: ${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      clearTimeout(timer);
      if (externalAbort) externalAbort.removeEventListener('abort', onExternalAbort);
    }
  },
};
