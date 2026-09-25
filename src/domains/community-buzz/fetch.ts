// ── Firecrawl 페치 (stealth 프록시로 Cloudflare 우회) · 버즈 P1 ──────────────
//
// PLAN §4a: Firecrawl 은 "가져오기" 레이어. ⚠️ 라이브 실증(2026-07-09): fmkorea 는
// Cloudflare Turnstile 뒤 → 기본 scrape 는 "Checking your Browser" 인터스티셜만 받음.
// → proxy:stealth + waitFor 로 우회(성공·~7s·크레딧 추가). v2 scrape 엔드포인트.
//
// 키: env FIRECRAWL_API_KEY → 스킬 .env 자립(크론/데몬 최소 PATH 대비).

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FIRECRAWL_V2_SCRAPE = 'https://api.firecrawl.dev/v2/scrape';
const FMKOREA_STOCK_URL = 'https://www.fmkorea.com/stock';

/** 키 소스 — env 우선, 없으면 omni-crawl 스킬 .env 자립 파싱. */
export function firecrawlKey(): string | null {
  const env = process.env.FIRECRAWL_API_KEY?.trim();
  if (env) return env;
  const envPath = join(homedir(), '.claude/skills/omni-crawl/.env');
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf-8').match(/^FIRECRAWL_API_KEY\s*=\s*["']?([^"'\n]+)/m);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export interface FetchListOpts {
  url?: string;
  waitFor?: number;      // JS/Cloudflare 대기(ms) 기본 4000
  timeoutMs?: number;    // 요청 타임아웃 기본 30s
  key?: string;          // 테스트/오버라이드
  retries?: number;      // 일시 오류 재시도(기본 1)
}

export class CloudflareBlockedError extends Error {}

/** fmkorea 리스트 마크다운. stealth 프록시 일시 오류(ERR_TUNNEL 등)는 1회 재시도(대표 관측).
 *  Cloudflare 차단은 재시도 안 함(내용 이슈). */
export async function fetchFmkoreaList(opts: FetchListOpts = {}): Promise<string> {
  const attempts = (opts.retries ?? 1) + 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await scrapeOnce(opts); }
    catch (e) {
      if (e instanceof CloudflareBlockedError) throw e; // 내용 이슈 — 재시도 무의미
      lastErr = e; // 일시 프록시/네트워크 — 재시도
    }
  }
  throw lastErr;
}

async function scrapeOnce(opts: FetchListOpts): Promise<string> {
  const key = opts.key ?? firecrawlKey();
  if (!key) throw new Error('FIRECRAWL_API_KEY 없음(env 또는 omni-crawl .env).');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(FIRECRAWL_V2_SCRAPE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.url ?? FMKOREA_STOCK_URL,
        formats: ['markdown'],
        onlyMainContent: true,
        proxy: 'stealth',            // ★ Cloudflare Turnstile 우회
        maxAge: 0,                   // ★ 캐시 우회 — velocity 는 매 폴 신선해야(기본 2일 캐시면 델타 0)
        waitFor: opts.waitFor ?? 4000,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`Firecrawl ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json() as { success?: boolean; data?: { markdown?: string } };
    const md = j?.data?.markdown ?? '';
    if (!md) throw new Error('빈 마크다운 응답.');
    if (md.includes('Checking your Browser') || md.includes('보안 시스템')) {
      throw new CloudflareBlockedError('Cloudflare 챌린지 통과 실패(stealth 재시도 필요).');
    }
    return md;
  } finally { clearTimeout(to); }
}
