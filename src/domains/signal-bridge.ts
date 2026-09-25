// ── Signal Bridge — 기존 수집 DB → signal pool 적재 (적응형 투자 A1b) ────────
//
// 수집기 자체를 재작성하지 않고, 기존 수집 결과(community_buzz.buzz_posts·
// breaking_signals.signals)를 pool 스키마로 매핑해 흘려보낸다(브릿지). ingest 멱등이라
// 재수집 안전. 순수 매퍼(IO 없음·테스트) + 사이클 스크립트가 소비.
//
// trust ρ(0~1): 커뮤니티 firehose 저신뢰(0.4)·뉴스/모니터(0.75)·공시(0.9). 미래 외부소스
// 가중 seam. 설계: 내부 문서 `DESIGN-adaptive-investment-autopilot-2026-07-11` §2.

import type { Signal } from './signal-pool.js';

export interface BuzzPostRow {
  id: string; ts: string; fetch_ts?: string | null; forum?: string | null;
  author?: string | null; title?: string | null; url?: string | null;
  tickers?: string | null; posted_at?: string | null;
  lane?: string | null; sentiment?: number | null;
}

/**
 * 커뮤니티 신뢰도 티어(대표 지시 2026-07-15) — 인기글(popular lane)은 크라우드 검증(추천·조회
 * 상위)이라 생 firehose 잡담보다 신뢰성 있게 취급. trust ρ 는 gate-chain 확장 임계와 미래 가중.
 */
export function communityTrust(lane?: string | null): number {
  return lane === 'popular' ? 0.6 : 0.4;
}

/** fmkorea 등 커뮤니티 buzz_post → Signal(source=community). 인기글 우대(popular=0.6). */
export function buzzPostToSignal(r: BuzzPostRow): Signal {
  const collected = r.fetch_ts || r.ts;
  const ticker = (r.tickers ?? '').split(/[,\s]+/).filter(Boolean)[0];
  return {
    eventId: r.id,
    source: 'community',
    ...(ticker ? { asset: ticker } : {}),
    observedAt: r.posted_at || r.ts,
    collectedAt: collected,
    origin: `${r.forum ?? 'community'}/${r.author ?? '?'}`,
    ...(r.url ? { evidenceUrl: r.url } : {}),
    trust: communityTrust(r.lane),
    ...(ticker ? { dedupGroup: ticker } : {}),
    raw: r.title ?? '',
  };
}

// ── 반복 하락 버즈 급증(bearish-flood) 감지 — 대표 지시 2026-07-15 ────────────────
//
// dedupGroup=ticker 만으로는 방향을 몰라 "반복 하락글 급증"과 일반 잡담을 구분 못 한다.
// focus/보유 티커에 한해 신뢰성 있는(non-spam·importance↑) 하락 정서 글이 임계 이상 몰리면
// 집계 신호 1건(시간버킷 멱등)을 합성 → gate1 이 S3(protection 후보)로 gate2 심층 판정에 회부.
// 비focus 티커(예: 하이닉스 잡담 다수)는 대상 아님(대표 결정: focus/보유 한정).

function normFocusSym(s: string): string {
  return s.replace(/\.(KO|KS|KQ|US)$/i, '').toUpperCase().trim();
}

/** buzz 티커가 focus 목록의 어느 종목과 일치하면 그 focus 심볼(원형)을 반환. 없으면 null. */
export function matchFocusSymbol(ticker: string, focusAssets: string[]): string | null {
  const n = normFocusSym(ticker);
  return focusAssets.find(f => normFocusSym(f) === n) ?? null;
}

export interface BearishBuzzRow {
  tickers: string | null; sentiment: number | null; importance: number | null;
  title: string | null; fetch_ts: string;
}

export interface BuzzTickerAgg {
  ticker: string;          // focus 심볼 원형(예: 005930.KO)
  bearishCount: number;
  avgSentiment: number;
  avgImportance: number;
  sampleTitle: string;
  lastTs: string;
}

/** 하락 정서 buzz row 를 focus 티커별로 집계(sentiment ≤ maxSentiment 만). 순수함수(테스트). */
export function aggregateBearish(
  rows: BearishBuzzRow[], focusAssets: string[], opts: { maxSentiment?: number } = {},
): BuzzTickerAgg[] {
  const maxSent = opts.maxSentiment ?? -0.3;
  const by = new Map<string, { sents: number[]; imps: number[]; sample: string; lastTs: string }>();
  for (const r of rows) {
    if (r.sentiment == null || r.sentiment > maxSent) continue;
    for (const t of (r.tickers ?? '').split(/[,\s]+/).filter(Boolean)) {
      const focus = matchFocusSymbol(t, focusAssets);
      if (!focus) continue;
      const e = by.get(focus) ?? { sents: [], imps: [], sample: r.title ?? '', lastTs: r.fetch_ts };
      e.sents.push(r.sentiment);
      e.imps.push(r.importance ?? 0);
      if (r.fetch_ts >= e.lastTs) { e.lastTs = r.fetch_ts; e.sample = r.title ?? e.sample; }
      by.set(focus, e);
    }
  }
  const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return [...by.entries()].map(([ticker, e]) => ({
    ticker, bearishCount: e.sents.length, avgSentiment: avg(e.sents),
    avgImportance: avg(e.imps), sampleTitle: e.sample, lastTs: e.lastTs,
  }));
}

/** 하락 급증 집계 → 보호신호 후보 합성. 티커·시간버킷당 1건(멱등). minBearish 미만은 제외. */
export function bearishFloodSignals(
  aggs: BuzzTickerAgg[], opts: { hourBucket: string; minBearish?: number; maxSentiment?: number },
): Signal[] {
  const min = opts.minBearish ?? 12;
  const maxSent = opts.maxSentiment ?? -0.2;
  const out: Signal[] = [];
  for (const a of aggs) {
    if (a.bearishCount < min || a.avgSentiment > maxSent) continue;
    out.push({
      eventId: `bearish-flood:${a.ticker}:${opts.hourBucket}`,
      source: 'community',
      asset: a.ticker,
      observedAt: a.lastTs,
      collectedAt: a.lastTs,
      origin: 'bearish-flood-detector',
      trust: Math.min(0.85, 0.5 + a.avgImportance / 20),
      proposedAction: 'protection',   // 방향=보호(구조화 필드 authoritative·오분류 fail-safe)
      dedupGroup: `bearish-flood:${a.ticker}`,
      raw: `반복 하락 버즈 급증 ${a.bearishCount}건 (평균감정 ${a.avgSentiment.toFixed(2)}·중요도 ${a.avgImportance.toFixed(1)}); "${a.sampleTitle}"`,
    });
  }
  return out;
}

export interface BreakingSignalRow {
  id: string; ts: string; source?: string | null; author?: string | null;
  text?: string | null; url?: string | null; sector?: string | null; reason?: string | null;
}

const DISCLOSURE_RE = /공시|규제|제재|sec|regulat|filing|8-k|10-k|10-q|disclos|antitrust/i;

/** 뉴스/모니터 signal → Signal(source=news 또는 disclosure). */
export function breakingSignalToSignal(r: BreakingSignalRow): Signal {
  const blob = `${r.text ?? ''} ${r.reason ?? ''}`;
  const isDisclosure = DISCLOSURE_RE.test(blob);
  return {
    eventId: r.id,
    source: isDisclosure ? 'disclosure' : 'news',
    observedAt: r.ts,
    collectedAt: r.ts,
    origin: r.author || r.source || 'news',
    ...(r.url ? { evidenceUrl: r.url } : {}),
    trust: isDisclosure ? 0.9 : 0.75,
    ...(r.sector ? { dedupGroup: r.sector } : {}),
    raw: r.text ?? '',
  };
}
