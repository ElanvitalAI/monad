// RFC #2161 Phase 6 — OpenAI discovery source.
//
// Calls https://api.openai.com/v1/models with bearer-token auth and
// normalises the OpenAI-shaped payload into `DiscoveredModel[]`.

import type {
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

const ENDPOINT = 'https://api.openai.com/v1/models';
const DEFAULT_TIMEOUT_MS = 4000;

interface OpenAiModelWire {
  id?: string;
  object?: string;
  owned_by?: string;
  created?: number;
}

export const openaiSource: DiscoverySource = {
  id: 'openai',
  async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      return {
        source: 'openai',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: 'missing-api-key: OPENAI_API_KEY env unset',
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
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const code = res.status;
        const detail = code === 401 || code === 403
          ? `upstream-auth-${code}`
          : `upstream-http-${code}`;
        return {
          source: 'openai',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: detail,
        };
      }
      const json = (await res.json().catch(() => null)) as
        | { data?: OpenAiModelWire[] } | null;
      const data = Array.isArray(json?.data) ? json!.data! : [];
      const lastSeen = new Date(now()).toISOString();
      const models = data
        .filter((m): m is OpenAiModelWire & { id: string } => typeof m?.id === 'string')
        .map((m) => ({
          id: m.id,
          provider: 'openai',
          partial: {
            id: m.id,
            provider: 'openai',
            displayName: m.id,
            ...(typeof m.created === 'number'
              ? { releaseDate: new Date(m.created * 1000).toISOString().slice(0, 10) }
              : {}),
          },
          discoveryMeta: {
            source: 'auto-openai-api' as const,
            lastSeen,
            autoFilled: true,
            confidence: 'high' as const,
          },
        }));
      return {
        source: 'openai',
        ok: true,
        models,
        durationMs: now() - startedAt,
      };
    } catch (e) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'openai',
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
