/**
 * Tavily integration — REST direct (specs/tavily/*.md 기준, 2026-07-06)
 *
 * 역할: 일반 웹 검색 + 뉴스 검색의 1순위 엔진 (basic 1 credit · advanced 2 credits).
 * grok-web($0.03/콜)보다 ~4배 저렴 + 빠름 → 대량 파이프라인(Conatus) 기본값.
 * extract는 firecrawl scrape 폴백용 경량 추출.
 *
 * 키: TAVILY_KEY (.env) — TAVILY_API_KEY도 수용.
 */

import type { CrawlResult, CrawlItem } from './types.js';
import { env } from './env.js';

const BASE = 'https://api.tavily.com';

function tavilyKey(): string {
  return env('TAVILY_KEY') || env('TAVILY_API_KEY');
}

export function tavilyAvailable(): boolean { return !!tavilyKey(); }

async function post(path: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
  const key = tavilyKey();
  if (!key) throw new Error('TAVILY_KEY 미설정 (.env)');
  // 1 retry on network error / 5xx — 파이프라인 안정성
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500 && attempt === 0) continue;
      if (!res.ok) throw new Error(`tavily ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return await res.json();
    } catch (e) {
      if (attempt === 0) continue;
      throw e;
    }
  }
}

export interface TavilySearchOpts {
  /** basic=1credit(기본) · advanced=2credits(chunks_per_source 지원·근거 강화) */
  depth?: 'basic' | 'advanced';
  /** general(기본) | news — 뉴스 인텐트 시 news */
  topic?: 'general' | 'news';
  maxResults?: number;          // 기본 5
  /** advanced 전용: 소스당 근거 청크 수 (스펙 권장 3) */
  chunksPerSource?: number;
  /** day|week|month|year — 최신성 필터 */
  timeRange?: string;
  includeRawContent?: boolean;  // 풀본문 (마크다운)
  includeAnswer?: boolean;      // AI 요약 씨드 (기본 off — 스펙 권장)
}

/** Tavily 웹/뉴스 검색 → CrawlResult. include_usage로 크레딧 소비 추적. */
export async function searchTavily(query: string, opts?: TavilySearchOpts): Promise<CrawlResult> {
  const depth = opts?.depth ?? 'basic';
  const topic = opts?.topic ?? 'general';
  const engine = topic === 'news' ? 'tavily-news' : 'tavily';
  console.log(`  [${engine}] 검색: "${query}" (depth=${depth}${opts?.timeRange ? `, time=${opts.timeRange}` : ''})`);

  const body: Record<string, unknown> = {
    query,
    search_depth: depth,
    topic,
    max_results: opts?.maxResults ?? 5,
    include_usage: true,
  };
  if (depth === 'advanced') body.chunks_per_source = opts?.chunksPerSource ?? 3;
  if (opts?.timeRange) body.time_range = opts.timeRange;
  if (opts?.includeRawContent) body.include_raw_content = 'markdown';
  if (opts?.includeAnswer) body.include_answer = true;

  const data = await post('/search', body);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const items: CrawlItem[] = results.map((r: any) => ({
    engine, query,
    url: r.url || '',
    text: r.raw_content || r.content || r.title || '',
    author: (() => { try { return new URL(r.url || 'https://x').hostname; } catch { return 'unknown'; } })(),
    date: r.published_date,
    metadata: { title: r.title, score: r.score },
  }));

  const credits = data?.usage?.credits ?? (depth === 'advanced' ? 2 : 1);
  console.log(`  [${engine}] ${items.length}건 (credits: ${credits}${data?.response_time ? `, ${data.response_time}s` : ''})`);
  return {
    engine, query, items,
    rawText: data?.answer || undefined,
    totalItems: items.length,
    // 비용 가시성 — 파이프라인 예산 모니터링
    ...( { costNote: `tavily ${credits}cr` } as any ),
  };
}

/** URL 본문 추출 (firecrawl scrape 폴백/경량 대체). basic 1cr/5URL. */
export async function extractTavily(urls: string[], opts?: { depth?: 'basic' | 'advanced' }): Promise<Array<{ url: string; content: string }>> {
  if (urls.length === 0) return [];
  console.log(`  [tavily-extract] ${urls.length}개 URL 추출`);
  const data = await post('/extract', {
    urls,
    extract_depth: opts?.depth ?? 'basic',
    format: 'markdown',
  }, 60_000);
  const ok: any[] = Array.isArray(data?.results) ? data.results : [];
  return ok.map((r: any) => ({ url: r.url, content: r.raw_content || '' })).filter(r => r.content);
}

/** 계정 사용량 (--health용). GET /usage. */
export async function usageTavily(): Promise<{ ok: boolean; detail: string }> {
  const key = tavilyKey();
  if (!key) return { ok: false, detail: 'TAVILY_KEY 미설정' };
  try {
    const res = await fetch(`${BASE}/usage`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const d = await res.json();
    const acct = d?.account ?? d;
    const used = acct?.current_plan_usage ?? acct?.plan_usage ?? d?.key?.usage ?? '?';
    const limit = acct?.plan_limit ?? acct?.current_plan_limit ?? '?';
    return { ok: true, detail: `plan ${used}/${limit} credits` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 80) || 'error' };
  }
}
