/**
 * Firecrawl integration — REST v2 직결 (specs/firecrawl/*.md 기준, 2026-07-06 재편)
 *
 * CLI shell-out 제거 이유(실측): 크론/데몬 최소 PATH에서 즉사(nvm 경로),
 * 키가 launchctl setenv 의존(재부팅/크론에서 증발), 콜당 146ms 스폰,
 * execSync 이벤트루프 블로킹(병렬성 파괴). REST는 .env 자립 + 진짜 병렬.
 *
 * v2 신능력 반영: sources(web/news) · categories(github/research) · tbs(기간)
 * · maxAge 캐시(기본 2일·최대 500% 가속 — Conatus 반복 파이프라인 비용 절감)
 * · batch/scrape · crawl(비동기 잡) · team/credit-usage.
 *
 * agent(FIRE-1)·browser(Interact)만 CLI 잔존 — 니치·대화형 (REST /browser
 * 세션 API 존재하나 세션 관리 복잡도 대비 이득 없음).
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CrawlResult, CrawlItem } from './types.js';
import { env } from './env.js';

const BASE = 'https://api.firecrawl.dev/v2';

function fcKey(): string { return env('FIRECRAWL_API_KEY'); }
export function firecrawlAvailable(): boolean { return !!fcKey(); }

async function api(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
  const key = fcKey();
  if (!key) throw new Error('FIRECRAWL_API_KEY 미설정 (.env)');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500 && attempt === 0) continue; // 1 retry on 5xx
      if (!res.ok) throw new Error(`firecrawl ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      return await res.json();
    } catch (e) {
      if (attempt === 0) continue; // 1 retry on network error
      throw e;
    }
  }
}

// ── 1. Search (POST /v2/search — sources·categories·tbs 지원) ──

export interface FcSearchOpts {
  limit?: number;
  scrape?: boolean;                       // 결과 페이지 본문까지 (scrapeOptions)
  sources?: Array<'web' | 'news' | 'images'>;  // v2: 뉴스/이미지 소스
  categories?: Array<'github' | 'research'>;   // v2: 특화 카테고리
  tbs?: string;                           // 기간 필터 (qdr:d 하루, qdr:w 주, qdr:m 월)
  location?: string;
}

export async function searchFirecrawl(query: string, opts?: FcSearchOpts): Promise<CrawlResult> {
  const limit = opts?.limit ?? 5;
  const sources = opts?.sources ?? ['web'];
  console.log(`  [firecrawl] 검색: "${query}" (limit=${limit}, sources=${sources.join('+')}${opts?.scrape ? ', +scrape' : ''}${opts?.tbs ? `, tbs=${opts.tbs}` : ''})`);

  const body: Record<string, unknown> = { query, limit, sources };
  if (opts?.categories?.length) body.categories = opts.categories;
  if (opts?.tbs) body.tbs = opts.tbs;
  if (opts?.location) body.location = opts.location;
  if (opts?.scrape) body.scrapeOptions = { formats: ['markdown'], onlyMainContent: true, blockAds: true };

  try {
    const data = await api('POST', '/search', body, 90_000);
    const buckets = data?.data ?? {};
    const items: CrawlItem[] = [];
    for (const src of ['web', 'news', 'images'] as const) {
      const arr: any[] = Array.isArray(buckets[src]) ? buckets[src] : [];
      for (const r of arr) {
        items.push({
          engine: 'firecrawl', query,
          url: r.url || '',
          text: r.markdown || r.description || r.snippet || r.title || '',
          author: (() => { try { return new URL(r.url || 'https://x').hostname; } catch { return 'unknown'; } })(),
          date: r.date,
          metadata: { title: r.title, source: src, position: r.position, category: r.category },
        });
      }
    }
    console.log(`  [firecrawl] ${items.length}개 결과`);
    return { engine: 'firecrawl', query, items, totalItems: items.length };
  } catch (e: any) {
    console.log(`  [firecrawl] 검색 실패: ${e.message?.split('\n')[0]}`);
    return { engine: 'firecrawl', query, items: [], totalItems: 0 };
  }
}

// ── 1-b. Developer Index (POST /v2/search/developer — 2026-08-20 출시) ──

/**
 * 코딩 에이전트용 «아티팩트» 인덱스 (README·외부 문서·이슈·PR·OpenAPI·스킬 저장소 7천만+).
 * 일반 웹 검색이 «페이지»를 주는 데 반해 여기는 «매칭 패시지(마크다운·표/코드블록 보존)»를
 * 직접 준다 — 스크랩 추가 콜 없이 바로 인용 가능(= deep 모드 크레딧 절감).
 *
 * ⚠️ 파라미터는 `limit` 이 아니라 **`k`** (`limit` 보내면 400 unrecognized_keys). 응답도
 *    `data` 가 아니라 **`results`** (다른 v2 엔드포인트와 봉투가 다르다 — 실측 2026-08-31).
 * ⚠️ language/topic/license/min_stars 는 «저장소» 사실이라, `sources` 스코프 없이 보내면
 *    doc 결과가 통째로 빠진다(문서 대부분은 뒤에 저장소가 없다). 사양이지 결함이 아니다.
 *
 * 비용 실측(2026-08-31): k=10·passages=2 → **2cr**.
 */
export interface FcDevOpts {
  k?: number;                                              // 1~100 (기본 10)
  types?: Array<'doc' | 'issue' | 'pull_request' | 'readme'>;
  passages?: number;                                       // 결과당 최대 패시지 1~5 (기본 1)
  repos?: string[];                                        // owner/name — «저장소» 반쪽 스코프
  sources?: string[];                                      // 문서 소스 id (최대 20) — «문서» 반쪽 스코프
  minStars?: number;
  skillsOnly?: boolean;                                    // 에이전트 스킬 파일만
}

export async function searchDeveloperFirecrawl(query: string, opts?: FcDevOpts): Promise<CrawlResult> {
  const k = opts?.k ?? 10;
  console.log(`  [fc-dev] 개발자 인덱스: "${query}" (k=${k}${opts?.types?.length ? `, types=${opts.types.join('+')}` : ''})`);

  const body: Record<string, unknown> = { query, k };
  if (opts?.types?.length) body.types = opts.types;
  if (opts?.passages) body.passages = opts.passages;
  if (opts?.repos?.length) body.repos = opts.repos;
  if (opts?.sources?.length) body.sources = opts.sources;
  if (opts?.minStars != null) body.min_stars = opts.minStars;
  if (opts?.skillsOnly) body.skills = 'only';

  try {
    const data = await api('POST', '/search/developer', body, 60_000);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const items: CrawlItem[] = results.map((r): CrawlItem => {
      const id: string = r.id || '';
      const kind = id.includes(':') ? id.slice(0, id.indexOf(':')) : 'unknown';  // doc|issue|pull_request|readme|web
      const passages: any[] = Array.isArray(r.passages) ? r.passages : [];
      return {
        engine: 'fc-dev', query,
        url: r.url || passages[0]?.citation_url || '',
        // 패시지가 곧 증거 — 여러 개면 구분선으로 잇는다(요약하지 않고 원문 그대로).
        text: passages.map(p => p.text || '').filter(Boolean).join('\n\n---\n\n') || r.title || '',
        // 렌더 헤딩에 쓰인다 — id 가 곧 «종류+출처»(issue:owner/repo#123) 라 가장 정보밀도가 높다.
        author: id || kind,
        metadata: {
          title: r.title || r.url, id, kind, license: r.license,
          citationUrls: passages.map(p => p.citation_url).filter(Boolean),
        },
      };
    });
    if (data?.partial) console.log('  [fc-dev] ⚠ partial=true (인덱스 일부만 응답)');
    console.log(`  [fc-dev] ${items.length}개 아티팩트`);
    return { engine: 'fc-dev', query, items, totalItems: items.length, costNote: 'fc-dev ~2cr' };
  } catch (e: any) {
    console.log(`  [fc-dev] 실패: ${e.message?.split('\n')[0]}`);
    return { engine: 'fc-dev', query, items: [], totalItems: 0 };
  }
}

// ── 2. Scrape (POST /v2/scrape — maxAge 캐시 기본 2일·500% 가속) ──

export interface FcScrapeOpts {
  waitFor?: number;
  /** ms — 이보다 신선한 캐시가 있으면 재사용 (API 기본 2일). 뉴스는 낮게. */
  maxAge?: number;
  formats?: string[];
}

export async function scrapeFirecrawl(url: string, opts?: FcScrapeOpts): Promise<{ title: string; content: string } | null> {
  try {
    const body: Record<string, unknown> = {
      url,
      formats: opts?.formats ?? ['markdown'],
      onlyMainContent: true,
      blockAds: true,
    };
    if (opts?.waitFor) body.waitFor = opts.waitFor;
    if (opts?.maxAge !== undefined) body.maxAge = opts.maxAge;

    const data = await api('POST', '/scrape', body, 90_000);
    const d = data?.data ?? {};
    const content: string = d.markdown || '';
    if (!content || content.length < 30) return null;
    const title = d.metadata?.title || (content.match(/^#\s+(.+)$/m)?.[1]?.trim()) || url;
    return { title, content };
  } catch (e: any) {
    console.log(`  [firecrawl] scrape 실패(${url.slice(0, 60)}): ${e.message?.split('\n')[0]}`);
    return null;
  }
}

// ── 3. Map (POST /v2/map — 사이트 URL 구조 탐색) ──

export async function mapFirecrawl(url: string, opts?: { limit?: number; search?: string }): Promise<string[]> {
  try {
    const body: Record<string, unknown> = { url };
    if (opts?.limit) body.limit = opts.limit;
    if (opts?.search) body.search = opts.search;
    const data = await api('POST', '/map', body, 60_000);
    const links = data?.data?.links || data?.links || data?.data || [];
    if (Array.isArray(links)) return links.map((l: any) => typeof l === 'string' ? l : l?.url).filter(Boolean);
    return [];
  } catch (e: any) {
    console.log(`  [firecrawl] map 실패: ${e.message?.split('\n')[0]}`);
    return [];
  }
}

// ── 4. Batch Scrape (POST /v2/batch/scrape — 대량 URL, 비동기 잡+폴링) ──

export async function batchScrapeFirecrawl(urls: string[], opts?: { maxAge?: number; pollMs?: number; timeoutMs?: number }): Promise<Array<{ url: string; title: string; content: string }>> {
  if (urls.length === 0) return [];
  console.log(`  [firecrawl] batch scrape: ${urls.length}개 URL`);
  const body: Record<string, unknown> = {
    urls,
    formats: ['markdown'],
    onlyMainContent: true,
    ...(opts?.maxAge !== undefined ? { maxAge: opts.maxAge } : {}),
  };
  const start = await api('POST', '/batch/scrape', body, 30_000);
  const id = start?.id;
  if (!id) throw new Error('batch scrape 잡 ID 없음');

  const deadline = Date.now() + (opts?.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, opts?.pollMs ?? 3_000));
    const st = await api('GET', `/batch/scrape/${id}`, undefined, 30_000);
    if (st?.status === 'completed') {
      const docs: any[] = Array.isArray(st?.data) ? st.data : [];
      return docs.map((d: any) => ({
        url: d.metadata?.sourceURL || d.metadata?.url || '',
        title: d.metadata?.title || '',
        content: d.markdown || '',
      })).filter(d => d.content);
    }
    if (st?.status === 'failed') throw new Error('batch scrape 실패');
  }
  throw new Error('batch scrape 타임아웃');
}

// ── 5. Crawl (POST /v2/crawl — 사이트 전체, 비동기 잡+폴링) ──

export async function crawlSiteFirecrawl(url: string, opts?: { limit?: number; pollMs?: number; timeoutMs?: number }): Promise<Array<{ url: string; title: string; content: string }>> {
  console.log(`  [firecrawl] crawl: ${url} (limit=${opts?.limit ?? 10})`);
  const start = await api('POST', '/crawl', {
    url,
    limit: opts?.limit ?? 10,
    scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
  }, 30_000);
  const id = start?.id;
  if (!id) throw new Error('crawl 잡 ID 없음');

  const deadline = Date.now() + (opts?.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, opts?.pollMs ?? 5_000));
    const st = await api('GET', `/crawl/${id}`, undefined, 30_000);
    if (st?.status === 'completed') {
      const docs: any[] = Array.isArray(st?.data) ? st.data : [];
      return docs.map((d: any) => ({
        url: d.metadata?.sourceURL || '',
        title: d.metadata?.title || '',
        content: d.markdown || '',
      })).filter(d => d.content);
    }
    if (st?.status === 'failed') throw new Error('crawl 실패');
  }
  throw new Error('crawl 타임아웃');
}

// ── 6. Credit usage (GET /v2/team/credit-usage — --health용) ──

export async function creditUsageFirecrawl(): Promise<{ ok: boolean; detail: string }> {
  if (!fcKey()) return { ok: false, detail: 'FIRECRAWL_API_KEY 미설정' };
  try {
    const d = await api('GET', '/team/credit-usage', undefined, 10_000);
    const rem = d?.data?.remainingCredits ?? d?.data?.remaining_credits ?? '?';
    const plan = d?.data?.planCredits ?? d?.data?.plan_credits ?? '';
    return { ok: true, detail: `remaining ${rem}${plan ? `/${plan}` : ''} credits` };
  } catch (e: any) {
    return { ok: false, detail: e?.message?.slice(0, 80) || 'error' };
  }
}

// ── 7. Smart Scrape: REST scrape → tavily extract은 호출측 폴백 ──

export async function smartScrape(url: string): Promise<{ title: string; content: string; method: string } | null> {
  const result = await scrapeFirecrawl(url);
  if (result && result.content.length > 100) {
    return { ...result, method: 'firecrawl-scrape' };
  }
  // waitFor 재시도 (JS 렌더링 페이지)
  const retry = await scrapeFirecrawl(url, { waitFor: 3000, maxAge: 0 });
  if (retry && retry.content.length > 100) {
    return { ...retry, method: 'firecrawl-scrape-wait' };
  }
  console.log(`  [firecrawl] scrape 부족 — 호출측 폴백(tavily extract / Dia CDP) 필요`);
  return null;
}

// ═══ CLI 잔존 구간 (agent/browser — 니치·대화형 전용) ═══
// ⚠ 크론/데몬 컨텍스트에서는 PATH/launchctl 의존으로 실패 가능. 대화형 세션 전용.

let _hasFirecrawlCli: boolean | null = null;
function hasFirecrawlCli(): boolean {
  if (_hasFirecrawlCli !== null) return _hasFirecrawlCli;
  try { execSync('firecrawl --version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }); _hasFirecrawlCli = true; } catch { _hasFirecrawlCli = false; }
  return _hasFirecrawlCli;
}

function tmpJson(): string { return join(tmpdir(), `omni-crawl-fc-${Date.now()}.json`); }

function parseJsonFile(path: string): any {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8').trim();
  try { unlinkSync(path); } catch {}
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export interface AgentResult {
  success: boolean;
  status: string;
  data: any;
  totalSteps?: number;
}

/** FIRE-1 에이전트 (CLI 전용 — 대화형). 자연어 → 웹 데이터 자동 추출. */
export function agentFirecrawl(prompt: string, opts?: {
  urls?: string[];
  model?: 'spark-1-mini' | 'spark-1-pro';
  schema?: string;
  timeout?: number;
}): AgentResult {
  if (!hasFirecrawlCli()) return { success: false, status: 'error', data: 'firecrawl CLI 미설치(대화형 전용 기능)' };

  const out = tmpJson();
  const urlsFlag = opts?.urls?.length ? ` --urls "${opts.urls.join(',')}"` : '';
  const modelFlag = opts?.model ? ` --model ${opts.model}` : '';
  const schemaFlag = opts?.schema ? ` --schema '${opts.schema}'` : '';
  const timeout = opts?.timeout ?? 120;

  console.log(`  [firecrawl] agent: "${prompt.slice(0, 80)}..." (timeout=${timeout}s)`);
  try {
    execSync(
      `firecrawl agent "${prompt}"${urlsFlag}${modelFlag}${schemaFlag} --wait --timeout ${timeout} --json -o "${out}"`,
      { encoding: 'utf-8', timeout: (timeout + 30) * 1000, stdio: 'pipe' },
    );
    const data = parseJsonFile(out);
    if (!data) return { success: false, status: 'no_output', data: null };
    return { success: data.success ?? true, status: data.status ?? 'completed', data: data.data ?? data, totalSteps: data.totalSteps };
  } catch (e: any) {
    const msg = e.message?.split('\n')[0] || 'unknown error';
    console.log(`  [firecrawl] agent 실패: ${msg}`);
    const jobMatch = msg.match(/Job ID:\s*(\S+)/);
    return { success: false, status: 'timeout', data: jobMatch ? `job_id: ${jobMatch[1]}` : msg };
  }
}
