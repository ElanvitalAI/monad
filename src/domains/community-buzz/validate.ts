// ── 버즈 신호 검증 (Goodhart 방지) · 버즈 P2f · 2026-07-09 ────────────────────
//
// 대표 지시: freshness/버즈 가중이 실제로 가격을 예측하는지 검증(예측 못 하면 노이즈 증폭).
// 검증: 커뮤니티 감정 방향(ticker별 buzz_posts sentiment 평균)이 실제 가격 방향과 맞나 →
// hit-rate. 방향 일치율이 우연(50%) 초과여야 신호에 알파. 현 데이터 얇으면 표본 부족 표기.
//
// ⚠️ 현 버전 = 동시성(coincident) 방향 체크(당일 changePct). 가격-at-emergence 저장 후엔
// 진짜 forward-return 백테스트로 승급 가능. 지금은 Goodhart 가드 메커니즘을 세운다.

import type { Database } from 'bun:sqlite';
import { timeKey, windowCompare, within } from '../../time/db-window.js';

export interface TickerSentiment { ticker: string; sentiment: number; n: number }

/** ticker_emergence 최근 종목별 커뮤니티 감정 평균(buzz_posts). */
export function emergedSentiments(db: Database, opts: { hours?: number; minPosts?: number } = {}): TickerSentiment[] {
  const hours = opts.hours ?? 48, minPosts = opts.minPosts ?? 2;
  const tickers = (db.prepare(`SELECT DISTINCT ticker FROM ticker_emergence WHERE ${within('ts')}`).all(`-${hours} hours`) as Array<{ ticker: string }>).map(r => r.ticker);
  const out: TickerSentiment[] = [];
  for (const ticker of tickers) {
    const r = db.prepare(
      `SELECT AVG(sentiment) a, COUNT(*) n FROM buzz_posts WHERE tickers LIKE ? AND sentiment IS NOT NULL AND ${within('fetch_ts')}`,
    ).get(`%${ticker}%`, `-${hours} hours`) as { a: number | null; n: number };
    if (r.n >= minPosts && r.a != null) out.push({ ticker, sentiment: Math.round(r.a * 100) / 100, n: r.n });
  }
  return out;
}

export interface ValidationSample { ticker: string; sentiment: number; move: number; hit: boolean }
export interface ValidationResult {
  samples: ValidationSample[];
  n: number;
  hits: number;
  hitRate: number | null;   // null = 표본 부족
  note: string;
}

/** 방향 검증 — 감정 부호 vs 가격 부호 일치. priceMove 주입(테스트 seam·null=시세없음 제외).
 *  threshold: |감정|·|move| 이 이보다 작으면 중립(제외). */
export function validateDirection(
  sentiments: TickerSentiment[],
  priceMove: (ticker: string) => number | null,
  opts: { sentThreshold?: number; moveThreshold?: number; minSample?: number } = {},
): ValidationResult {
  const st = opts.sentThreshold ?? 0.15, mt = opts.moveThreshold ?? 0.3, minSample = opts.minSample ?? 5;
  const samples: ValidationSample[] = [];
  for (const s of sentiments) {
    if (Math.abs(s.sentiment) < st) continue; // 중립 감정 제외
    const move = priceMove(s.ticker);
    if (move == null || Math.abs(move) < mt) continue; // 시세 없음/미미 제외
    samples.push({ ticker: s.ticker, sentiment: s.sentiment, move: Math.round(move * 100) / 100, hit: Math.sign(s.sentiment) === Math.sign(move) });
  }
  const n = samples.length, hits = samples.filter(s => s.hit).length;
  const hitRate = n >= minSample ? Math.round((hits / n) * 100) / 100 : null;
  const note = hitRate == null
    ? `표본 부족(${n}/${minSample}) — 며칠 더 누적 필요. Goodhart 가드는 가동(메커니즘 준비).`
    : hitRate > 0.55 ? `hit-rate ${hitRate} > 0.55 — 신호에 방향성 알파(우연 초과).`
    : hitRate < 0.45 ? `⚠️ hit-rate ${hitRate} < 0.45 — 역상관/노이즈 의심. 가중 재검토.`
    : `hit-rate ${hitRate} ≈ 0.5 — 방향 예측력 약함(우연 수준). 신호 재점검.`;
  return { samples, n, hits, hitRate, note };
}

// ── forward-return 백테스트(승급) — 동시성이 아니라 진짜 예측력 ────────────────
//
// 동시성 검증(위)의 한계: 커뮤니티는 "이미 오른 걸 보고" 떠들 수 있어 sentiment↔당일가격
// 일치율이 높아도 매매엔 무의미(그 상승은 지나감). 승급 = emergence "시점"의 가격을 앵커로
// 저장(price_at_emergence)하고, N일 뒤 실제 가격과 비교해 forward-return 을 측정한다.
// "SNS가 뉴스/가격보다 먼저 움직인다"는 트랙 존재이유를 미래 수익으로 정량화.

export interface EmergenceRow { ticker: string; ts: string; priceAt: number; sentiment: number | null }

/** forward-return 대상 — 티커별 "최초" emergence(가격 있음) 중 forward 창이 경과한 행.
 *  minHoldHours: 이 시간 이상 지나야 forward 측정 가능(창 경과). maxAgeHours: 너무 오래된 건 제외. */
export function forwardCandidates(db: Database, opts: { minHoldHours?: number; maxAgeHours?: number } = {}): EmergenceRow[] {
  const minHold = opts.minHoldHours ?? 24, maxAge = opts.maxAgeHours ?? 168;
  const rows = db.prepare(
    // ⚠️ `MIN(ts)` 는 **문자열 최소**라 저장 형식이 섞이면 실제 최초 행을 못 고른다(리뷰 must-fix).
    //    그렇다고 `MIN(datetime(ts))` 로 바꾸면 **초가 잘려** 같은 초의 여러 행이 동률이 된다.
    //    ⇒ 극값 키는 정밀도를 보존하는 `timeKey()`(julianday) 로 잡는다.
    //    ⊕ SQLite 는 집계가 MIN/MAX 하나뿐일 때 **bare 컬럼을 그 극값 행에서** 가져온다.
    //      그 규칙을 써서 `ts`·`price_at_emergence` 는 원문 그대로(정확한 최초 행) 돌려받는다.
    `SELECT ticker, ts, price_at_emergence priceAt, sentiment_at_emergence sentiment,
            MIN(${timeKey('ts')}) AS _firstKey
       FROM ticker_emergence
      WHERE price_at_emergence IS NOT NULL
        AND ${windowCompare('ts', '<=')} AND ${within('ts')}
      GROUP BY ticker`,
  ).all(`-${minHold} hours`, `-${maxAge} hours`) as Array<{ ticker: string; ts: string; priceAt: number; sentiment: number | null }>;
  return rows.map(r => ({ ticker: r.ticker, ts: r.ts, priceAt: r.priceAt, sentiment: r.sentiment }));
}

export interface ForwardSample { ticker: string; sentiment: number | null; priceAt: number; priceNow: number; ret: number; hit: boolean | null }
export interface ForwardResult {
  samples: ForwardSample[];
  n: number;                    // forward 수익률 측정된 표본
  directional: number;          // 그중 감정 방향이 있는(중립 아님) 표본
  hits: number;                 // 감정 방향 == 수익 방향
  hitRate: number | null;       // null = 방향 표본 부족
  meanRet: number | null;       // 전체 평균 forward 수익률(%)
  meanRetBull: number | null;   // 강세 감정 emergence 의 평균 forward 수익률
  note: string;
}

/** forward-return 방향/수익 검증 — priceNow 주입(테스트 seam·null=시세없음 제외).
 *  감정 부호 vs forward 수익 부호 일치=hit(방향 알파). 강세 emergence 평균수익도 리포트. */
export function validateForwardReturns(
  rows: EmergenceRow[],
  priceNow: (ticker: string) => number | null,
  opts: { sentThreshold?: number; retThreshold?: number; minSample?: number } = {},
): ForwardResult {
  const st = opts.sentThreshold ?? 0.15, rt = opts.retThreshold ?? 0.5, minSample = opts.minSample ?? 5;
  const samples: ForwardSample[] = [];
  for (const r of rows) {
    if (!(r.priceAt > 0)) continue;
    const now = priceNow(r.ticker);
    if (now == null || !(now > 0)) continue; // 시세 없음 제외
    const ret = Math.round(((now - r.priceAt) / r.priceAt) * 10000) / 100; // %
    // 방향 hit: 감정이 유의(|s|≥st)이고 수익이 유의(|ret|≥rt)일 때만 판정, 아니면 null(방향 미평가).
    const directional = r.sentiment != null && Math.abs(r.sentiment) >= st && Math.abs(ret) >= rt;
    const hit = directional ? Math.sign(r.sentiment!) === Math.sign(ret) : null;
    samples.push({ ticker: r.ticker, sentiment: r.sentiment, priceAt: r.priceAt, priceNow: now, ret, hit });
  }
  const n = samples.length;
  const dir = samples.filter(s => s.hit != null);
  const hits = dir.filter(s => s.hit === true).length;
  const hitRate = dir.length >= minSample ? Math.round((hits / dir.length) * 100) / 100 : null;
  const mean = (xs: number[]): number | null => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
  const meanRet = mean(samples.map(s => s.ret));
  const meanRetBull = mean(samples.filter(s => s.sentiment != null && s.sentiment >= st).map(s => s.ret));
  const note = hitRate == null
    ? `forward 방향 표본 부족(${dir.length}/${minSample}) — 며칠 더 누적 필요(가격 앵커는 적재 중).`
    : hitRate > 0.55 ? `forward hit-rate ${hitRate} > 0.55 — 진짜 예측력 알파(동시성 아님).`
    : hitRate < 0.45 ? `⚠️ forward hit-rate ${hitRate} < 0.45 — 역방향/노이즈. 신호 재검토.`
    : `forward hit-rate ${hitRate} ≈ 0.5 — 예측력 약함(우연). 승급 신호 재점검.`;
  return { samples, n, directional: dir.length, hits, hitRate, meanRet, meanRetBull, note };
}
