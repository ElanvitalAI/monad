// Firecrawl web-search provider.
//
// Auto-registered alongside Grok in src/web-search/index.ts via
// `addWebSearchProvider`. Available iff the canonical Firecrawl config
// resolver returns an API key (user-config first, then legacy env fallback).
//
// Calls Firecrawl's /v1/search endpoint (REST). Returns up to
// `limit` hits (default 5). allowDomains / blockDomains pass
// through; recencyDays unsupported by Firecrawl search and silently
// dropped.

import { getFirecrawlConfig } from '../registry/discovery/config.js';
import {
  type WebSearchHit,
  type WebSearchProvider,
  type WebSearchQuery,
  type WebSearchResult,
} from './provider.js';

const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/search';

type FirecrawlConfigResolver = () => { apiKey: string };

export function buildFirecrawlWebSearchProvider(
  resolveConfig: FirecrawlConfigResolver = getFirecrawlConfig,
): WebSearchProvider {
  return {
    id: 'firecrawl',
    displayName: 'Firecrawl',
    available: () => !!resolveConfig().apiKey,
    async search(q: WebSearchQuery, signal?: AbortSignal): Promise<WebSearchResult> {
      const key = resolveConfig().apiKey;
      if (!key) throw new Error('Firecrawl API key not configured');
      const limit = Math.max(1, Math.min(q.limit ?? 5, 20));
      const body: Record<string, unknown> = { query: q.query, limit };
      // Firecrawl supports "tbs" hints for recency but not direct
      // domain filtering on /v1/search; we pre-/post-filter.
      const resp = await fetch(FIRECRAWL_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) {
        throw new Error(`Firecrawl search HTTP ${resp.status}`);
      }
      const json = await resp.json() as { data?: Array<Record<string, unknown>> };
      const items = Array.isArray(json.data) ? json.data : [];
      let hits: WebSearchHit[] = items.map(it => ({
        url: String(it.url ?? ''),
        title: String(it.title ?? it.url ?? '(untitled)'),
        snippet: String(it.description ?? it.snippet ?? ''),
        metadata: it,
      })).filter(h => h.url);

      if (q.allowDomains && q.allowDomains.length > 0) {
        const allow = q.allowDomains.map(d => d.toLowerCase());
        hits = hits.filter(h => allow.some(d => safeHostname(h.url).endsWith(d)));
      }
      if (q.blockDomains && q.blockDomains.length > 0) {
        const block = q.blockDomains.map(d => d.toLowerCase());
        hits = hits.filter(h => !block.some(d => safeHostname(h.url).endsWith(d)));
      }

      return { hits, providerName: 'firecrawl', durationMs: 0 };
    },
  };
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
