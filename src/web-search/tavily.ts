// Tavily web-search provider.
//
// Registered FIRST in src/web-search/index.ts (2026-07-06 재편): 일반 웹
// 검색에서 grok Agent-Tools($0.03/콜·~11s) 대비 30배 저렴(basic 1cr≈$0.008)·
// 20배 빠름(~1s) 실측. Grok은 폴백 + X/community 특화로 잔존(providerId로
// 강제 선택 가능). 실패 시 레지스트리가 grok → firecrawl로 캐스케이드.
//
// Key sourcing: TAVILY_KEY / TAVILY_API_KEY env가 우선이지만, 데몬 프로세스는
// 보통 이 키를 안 갖고 있으므로(셸/launchctl 비상속) omni-crawl 스킬의 .env를
// 폴백으로 self-load한다 — kr-flow의 .env 자립 패턴과 동일.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type WebSearchHit,
  type WebSearchProvider,
  type WebSearchQuery,
  type WebSearchResult,
} from './provider.js';

const TAVILY_API = 'https://api.tavily.com/search';

let _cachedKey: string | null | undefined;
function tavilyKey(): string | null {
  if (_cachedKey !== undefined) return _cachedKey;
  const fromEnv = process.env.TAVILY_KEY?.trim() || process.env.TAVILY_API_KEY?.trim();
  if (fromEnv) { _cachedKey = fromEnv; return _cachedKey; }
  // Fallback: omni-crawl 스킬 .env self-load (daemon env 비의존)
  try {
    const envPath = process.env.TAVILY_ENV_FILE
      ?? join(homedir(), '.claude', 'skills', 'omni-crawl', '.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = t.match(/^TAVILY(?:_API)?_KEY=(.+)$/);
      if (m) { _cachedKey = m[1].trim(); return _cachedKey; }
    }
  } catch { /* fail-soft */ }
  _cachedKey = null;
  return _cachedKey;
}

/** Test hook — clears the memoized key so env changes take effect. */
export function _resetTavilyKeyCacheForTests(): void { _cachedKey = undefined; }

function recencyToTimeRange(days?: number): string | undefined {
  if (!days || days <= 0) return undefined;
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'year';
}

export function buildTavilyWebSearchProvider(): WebSearchProvider {
  return {
    id: 'tavily',
    displayName: 'Tavily',
    available: () => !!tavilyKey(),
    async search(q: WebSearchQuery, signal?: AbortSignal): Promise<WebSearchResult> {
      const key = tavilyKey();
      if (!key) throw new Error('TAVILY_KEY not set');
      const started = Date.now();
      const limit = Math.max(1, Math.min(q.limit ?? 5, 20));
      const body: Record<string, unknown> = {
        query: q.query,
        search_depth: 'basic',
        max_results: limit,
      };
      // Tavily는 도메인 필터·최신성 필터를 네이티브 지원 (firecrawl과 달리 서버측).
      if (q.allowDomains?.length) body.include_domains = q.allowDomains;
      if (q.blockDomains?.length) body.exclude_domains = q.blockDomains;
      const tr = recencyToTimeRange(q.recencyDays);
      if (tr) body.time_range = tr;

      const resp = await fetch(TAVILY_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) {
        throw new Error(`Tavily search HTTP ${resp.status}`);
      }
      const json = await resp.json() as {
        results?: Array<Record<string, unknown>>;
        answer?: string;
      };
      const items = Array.isArray(json.results) ? json.results : [];
      const hits: WebSearchHit[] = items.map(it => ({
        url: String(it.url ?? ''),
        title: String(it.title ?? it.url ?? '(untitled)'),
        snippet: String(it.content ?? ''),
        score: typeof it.score === 'number' ? it.score : undefined,
        publishedAt: it.published_date ? Date.parse(String(it.published_date)) || undefined : undefined,
        metadata: it,
      })).filter(h => h.url);

      return {
        hits,
        providerName: 'tavily',
        durationMs: Date.now() - started,
        ...(json.answer ? { note: `answer: ${String(json.answer).slice(0, 300)}` } : {}),
      };
    },
  };
}
