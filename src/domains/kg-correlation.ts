// ── 온톨로지 시계열 상관 (M5 P4 · R6·R8 · 2026-07-08) ─────────────────────
//
// 엣지 weight 를 과거 가격 시계열에서 실증 도출(대표 R6). 정적 추정이 아니라
// rolling correlation(±·R8 음수 허용) + cross-correlation lead-lag(전파 시차·마이크론→
// 삼성). 순수함수(테스트 결정론) + 가격 로더(screener.db KR·us_pulse.db US).
//
// ★ 룩어헤드 가드: 상관은 과거 데이터만 사용(미래 누설 금지·factor-backtest 원칙).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { SCREENER_DB_PATH, US_PULSE_DB_PATH } from './sector-store.js';

export interface PriceBar { date: string; close: number }

/** 로그수익률 — ln(c[t]/c[t-1]). close>0 전제(로더가 필터). */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1]!, c = closes[i]!;
    if (p > 0 && c > 0) out.push(Math.log(c / p));
    else out.push(0);
  }
  return out;
}

/** Pearson 상관계수 ∈ [-1,1]. 길이 불일치/분산0 = null. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma, db = b[i]! - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va <= 0 || vb <= 0) return null;
  const r = cov / Math.sqrt(va * vb);
  return Math.max(-1, Math.min(1, r));
}

/** 두 bar 시계열을 공통 date 로 정렬 → 종가 배열 쌍(date asc). */
export function alignByDate(a: PriceBar[], b: PriceBar[]): { dates: string[]; a: number[]; b: number[] } {
  const mb = new Map(b.map(x => [x.date, x.close]));
  const dates: string[] = [], ca: number[] = [], cb: number[] = [];
  for (const x of a) {
    const y = mb.get(x.date);
    if (y !== undefined) { dates.push(x.date); ca.push(x.close); cb.push(y); }
  }
  return { dates, a: ca, b: cb };
}

/** rolling correlation(R6·R8) — 공통 date 정렬 → 로그수익률 → 최근 window Pearson. */
export function computeCorrelation(barsA: PriceBar[], barsB: PriceBar[], window = 60): number | null {
  const al = alignByDate(barsA, barsB);
  if (al.dates.length < 4) return null;
  const ra = logReturns(al.a), rb = logReturns(al.b);
  const take = Math.min(window, ra.length);
  return pearson(ra.slice(-take), rb.slice(-take));
}

/** 특정 lag 에서의 상관 — lag>0: a 가 b 를 lag 일 선행(a[t] vs b[t+lag]). */
export function corrAtLag(ra: number[], rb: number[], lag: number): number | null {
  if (lag >= 0) return pearson(ra.slice(0, ra.length - lag), rb.slice(lag));
  return pearson(ra.slice(-lag), rb.slice(0, rb.length + lag));
}

export interface LeadLag { lag: number; corr: number }

/** cross-correlation lead-lag(R6·R3) — |corr| 최대 lag. lag>0 = a 가 b 를 lag 일 선행
 *  (마이크론 US → 삼성 KR). 정렬·로그수익률 후 [-maxLag, maxLag] 탐색. */
export function computeLeadLag(barsA: PriceBar[], barsB: PriceBar[], maxLag = 5, window = 60): LeadLag | null {
  const al = alignByDate(barsA, barsB);
  if (al.dates.length < maxLag + 4) return null;
  let ra = logReturns(al.a), rb = logReturns(al.b);
  const take = Math.min(window, ra.length);
  ra = ra.slice(-take); rb = rb.slice(-take);
  let best: LeadLag | null = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const c = corrAtLag(ra, rb, lag);
    if (c === null) continue;
    if (!best || Math.abs(c) > Math.abs(best.corr)) best = { lag, corr: c };
  }
  return best;
}

// ── 가격 로더 (READ-ONLY·fail-soft) ───────────────────────────────────────

/** screener.db prices(KR·code) → Map<code, PriceBar[]>(date asc·close>0). */
export function loadKrPrices(codes: string[], fromDate: string, path: string = SCREENER_DB_PATH): Map<string, PriceBar[]> {
  const out = new Map<string, PriceBar[]>();
  if (!codes.length || !existsSync(path)) return out;
  const db = new Database(path, { readonly: true });
  try {
    const ph = codes.map(() => '?').join(',');
    const rows = db.query(
      `SELECT code, date, close FROM prices WHERE code IN (${ph}) AND date >= ? AND close > 0 ORDER BY code, date ASC`,
    ).all(...codes, fromDate) as Array<{ code: string; date: string; close: number }>;
    for (const r of rows) { let a = out.get(r.code); if (!a) { a = []; out.set(r.code, a); } a.push({ date: r.date, close: r.close }); }
  } catch { /* fail-soft */ } finally { db.close(); }
  return out;
}

/** us_pulse.db bars(US·symbol) → Map<symbol, PriceBar[]>(date asc·close>0). */
export function loadUsPrices(symbols: string[], fromDate: string, path: string = US_PULSE_DB_PATH): Map<string, PriceBar[]> {
  const out = new Map<string, PriceBar[]>();
  if (!symbols.length || !existsSync(path)) return out;
  const db = new Database(path, { readonly: true });
  try {
    const ph = symbols.map(() => '?').join(',');
    const rows = db.query(
      `SELECT symbol, date, close FROM bars WHERE symbol IN (${ph}) AND date >= ? AND close > 0 ORDER BY symbol, date ASC`,
    ).all(...symbols, fromDate) as Array<{ symbol: string; date: string; close: number }>;
    for (const r of rows) { let a = out.get(r.symbol); if (!a) { a = []; out.set(r.symbol, a); } a.push({ date: r.date, close: r.close }); }
  } catch { /* fail-soft */ } finally { db.close(); }
  return out;
}
