// RFC #2161 Phase 6 FU — Gemini discovery source.
//
// Calls https://generativelanguage.googleapis.com/v1beta/models with the
// Google AI Studio `x-goog-api-key` header and normalises the response
// into `DiscoveredModel[]`. The API returns `models[].name` shaped as
// `'models/gemini-3.1-pro-preview'` — strip the `'models/'` prefix to
// match the catalog convention used by the static yaml seed.

import type {
  DiscoverySource,
  DiscoverySourceOpts,
  DiscoverySourceResult,
} from '../types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 4000;

interface GeminiModelWire {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

function stripModelsPrefix(raw: string): string {
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

export const geminiSource: DiscoverySource = {
  id: 'gemini',
  async run(opts: DiscoverySourceOpts = {}): Promise<DiscoverySourceResult> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const now = opts.now ?? Date.now;
    const startedAt = now();
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
    if (!apiKey) {
      return {
        source: 'gemini',
        ok: false,
        models: [],
        durationMs: now() - startedAt,
        error: 'missing-api-key: GEMINI_API_KEY env unset',
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
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!res.ok) {
        const code = res.status;
        const detail = code === 401 || code === 403
          ? `upstream-auth-${code}`
          : `upstream-http-${code}`;
        return {
          source: 'gemini',
          ok: false,
          models: [],
          durationMs: now() - startedAt,
          error: detail,
        };
      }
      const json = (await res.json().catch(() => null)) as
        | { models?: GeminiModelWire[] } | null;
      const data = Array.isArray(json?.models) ? json!.models! : [];
      const lastSeen = new Date(now()).toISOString();
      const models = data
        .filter((m): m is GeminiModelWire & { name: string } => typeof m?.name === 'string')
        .map((m) => {
          const id = stripModelsPrefix(m.name);
          return {
            id,
            provider: 'gemini',
            partial: {
              id,
              provider: 'gemini',
              displayName: m.displayName ?? id,
              ...(typeof m.inputTokenLimit === 'number' ? { contextSize: m.inputTokenLimit } : {}),
              ...(typeof m.outputTokenLimit === 'number' ? { outputMaxTokens: m.outputTokenLimit } : {}),
            },
            discoveryMeta: {
              source: 'auto-gemini-api' as const,
              lastSeen,
              autoFilled: true,
              confidence: 'high' as const,
            },
          };
        });
      return {
        source: 'gemini',
        ok: true,
        models,
        durationMs: now() - startedAt,
      };
    } catch (e) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      return {
        source: 'gemini',
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
