// RFC #2161 Phase 6 FU — xAI Grok discovery source.
//
// xAI exposes an OpenAI-compatible /v1/models surface
// (https://api.x.ai/v1/models · Bearer auth via `XAI_API_KEY`). The
// payload shape is identical to OpenAI's, so we reuse the same
// normalisation pattern; only the endpoint + auth env differ.

import type {
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

const ENDPOINT = 'https://api.x.ai/v1/models';
const DEFAULT_TIMEOUT_MS = 4000;

interface GrokModelWire {
  id?: string;
  object?: string;
  owned_by?: string;
  created?: number;
}

export const grokSource: DiscoverySource = {
  id: 'grok',
  async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = process.env.XAI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      return {
        source: 'grok',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: 'missing-api-key: XAI_API_KEY env unset',
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
          source: 'grok',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: detail,
        };
      }
      const json = (await res.json().catch(() => null)) as
        | { data?: GrokModelWire[] } | null;
      const data = Array.isArray(json?.data) ? json!.data! : [];
      const lastSeen = new Date(now()).toISOString();
      const models = data
        .filter((m): m is GrokModelWire & { id: string } => typeof m?.id === 'string')
        .map((m) => ({
          id: m.id,
          provider: 'grok',
          partial: {
            id: m.id,
            provider: 'grok',
            displayName: m.id,
            ...(typeof m.created === 'number'
              ? { releaseDate: new Date(m.created * 1000).toISOString().slice(0, 10) }
              : {}),
          },
          discoveryMeta: {
            source: 'auto-grok-api' as const,
            lastSeen,
            autoFilled: true,
            confidence: 'high' as const,
          },
        }));
      return {
        source: 'grok',
        ok: true,
        models,
        durationMs: now() - startedAt,
      };
    } catch (e) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'grok',
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
