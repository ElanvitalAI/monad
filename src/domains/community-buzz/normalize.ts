// ── Tier 0 정규화 — 빠른 기법(무LLM·sub-ms) · P1.5 · 2026-07-09 ──────────────
//
// PLAN §4d. 포스트당 결정론적 정규화: cashtag 정규식 + 사전 룩업 → 티커/entity/긍부정.
// 전량 파이어호스를 LLM 없이 커버(대표 "빠른 기법"). 모호·신조어는 Tier1 로컬 LLM(P2).
// 순수 함수(무IO) — 실제 fmkorea 제목으로 단위테스트.

import type { SlangEntry, SlangType } from './slang-dict.js';

export interface NormalizeResult {
  tickers: string[];   // 종목코드/티커(대문자·dedup) — cashtag + 사전
  entities: string[];  // canonical entity(외국인·야간선물...)
  sentiments: Array<{ term: string; canonical: string; polarity: number }>;
  matched: Array<{ term: string; canonical: string; type: SlangType }>;
  polarity: number | null; // 매칭된 긍부정 평균(-1..+1) · 없으면 null
}

// cashtag: $AAPL·$tsla (1~5 alpha). 오탐 블록(일반어 대문자 티커화 방지).
const CASHTAG_RE = /\$([A-Za-z]{1,5})\b/g;
const TICKER_BLOCKLIST = new Set(['A', 'I', 'IT', 'ALL', 'ON', 'OR', 'BE', 'GO', 'SO', 'AI', 'US', 'CEO', 'IPO', 'ATH']);

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 텍스트 → 정규화 결과. en 은 단어경계·ko 는 substring(한국어 무경계). 긴 term 우선(멀티워드). */
export function normalizeText(text: string, entries: SlangEntry[]): NormalizeResult {
  const lc = text.toLowerCase();
  const tickers = new Set<string>();
  const entities = new Set<string>();
  const sentiments: NormalizeResult['sentiments'] = [];
  const matched: NormalizeResult['matched'] = [];

  for (const m of text.matchAll(CASHTAG_RE)) {
    const t = m[1]!.toUpperCase();
    if (!TICKER_BLOCKLIST.has(t)) tickers.add(t);
  }

  const seen = new Set<string>();
  for (const e of [...entries].sort((a, b) => b.term.length - a.term.length)) {
    const hit = e.lang === 'en'
      ? new RegExp(`\\b${escapeRegex(e.term)}\\b`, 'i').test(text)
      : lc.includes(e.term.toLowerCase());
    if (!hit) continue;
    const key = `${e.type}:${e.canonical}`;
    if (seen.has(key)) continue; // 같은 canonical 중복 방지(하이닉스/sk하이닉스)
    seen.add(key);
    matched.push({ term: e.term, canonical: e.canonical, type: e.type });
    if (e.type === 'ticker' && e.ticker) tickers.add(e.ticker);
    else if (e.type === 'entity') entities.add(e.canonical);
    else if (e.type === 'sentiment') sentiments.push({ term: e.term, canonical: e.canonical, polarity: e.polarity ?? 0 });
  }

  const polarity = sentiments.length ? Math.round((sentiments.reduce((s, x) => s + x.polarity, 0) / sentiments.length) * 100) / 100 : null;
  return { tickers: [...tickers], entities: [...entities], sentiments, matched, polarity };
}
