// ── 섹터 매력도 저장소 + 오케스트레이터 (SP1 · 2026-07-07) ────────────────
//
// sector-attractiveness(순수 계산)의 I/O 경계. 데이터는 screener.db prices(로컬·백필
// 완료) 재사용 — omni-market 재호출 없음. 결과는 screener.db sector_scores(monad 소유·
// 기존 외부 파이썬 sector 테이블과 별개) 에 3 window(daily/weekly/monthly) × market 저장.
//
// ★ 기존 sector 테이블(외부 파이썬 monthly)은 deprecated — regime 은 sector_scores 를 읽는다.

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  computeSectorScores, usSectorChains, KR_CHAINS, type PriceBar, type SectorScore,
  type SectorWindow, type SectorMarket, type SectorGranularity,
} from './sector-attractiveness.js';
import { SECTOR_ETFS, ANCHOR_ETFS } from './us-pulse.js';
import { conatusPath } from './conatus-data-dir.js';

export const SCREENER_DB_PATH = conatusPath('screener.db');
export const US_PULSE_DB_PATH = conatusPath('us_pulse.db');
const ALL_WINDOWS: SectorWindow[] = ['daily', 'weekly', 'monthly'];

/** prices 테이블에서 종목별 종가 시계열(date asc) 로드. fromDate 이후만(경량). */
export function loadPricesForCodes(db: Database, codes: string[], fromDate: string): Map<string, PriceBar[]> {
  const out = new Map<string, PriceBar[]>();
  if (!codes.length) return out;
  const ph = codes.map(() => '?').join(',');
  const rows = db.query(
    `SELECT code, date, close FROM prices WHERE code IN (${ph}) AND date >= ? AND close > 0 ORDER BY code, date ASC`,
  ).all(...codes, fromDate) as Array<{ code: string; date: string; close: number }>;
  for (const r of rows) {
    let arr = out.get(r.code);
    if (!arr) { arr = []; out.set(r.code, arr); }
    arr.push({ date: r.date, close: r.close });
  }
  return out;
}

/** sector_scores 테이블(멱등·PK date+market+window+chain). monad 소유. */
export function openSectorDb(path: string = SCREENER_DB_PATH): Database {
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS sector_scores(
    date TEXT, market TEXT, window TEXT, chain TEXT,
    mom REAL, breadth REAL, score REAL, n INT, rank INT,
    PRIMARY KEY(date, market, window, chain))`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sector_scores ON sector_scores(date, market, window, rank)`);
  return db;
}

/** 저장(멱등·INSERT OR REPLACE). asOf = 계산 기준일(YYYY-MM-DD). */
export function saveSectorScores(db: Database, asOf: string, scores: SectorScore[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO sector_scores(date, market, window, chain, mom, breadth, score, n, rank)
     VALUES (?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((rows: SectorScore[]) => {
    for (const s of rows) stmt.run(asOf, s.market, s.window, s.chain, s.mom, s.breadth, s.score, s.n, s.rank);
  });
  tx(scores);
}

/** 최근 sector_scores 조회(regime·리포트 소비용). market+window 지정. rank asc. */
export function readSectorScores(
  db: Database, market: SectorMarket, window: SectorWindow, opts: { limit?: number; asOf?: string } = {},
): SectorScore[] {
  const asOf = opts.asOf ?? (db.query(
    `SELECT MAX(date) d FROM sector_scores WHERE market=? AND window=?`,
  ).get(market, window) as { d: string } | null)?.d;
  if (!asOf) return [];
  const lim = opts.limit ?? 100;
  const rows = db.query(
    `SELECT market, window, chain, mom, breadth, score, n, rank FROM sector_scores
     WHERE date=? AND market=? AND window=? ORDER BY rank ASC LIMIT ?`,
  ).all(asOf, market, window, lim) as SectorScore[];
  return rows;
}

/** us_pulse.db bars 에서 심볼별 종가 시계열(date asc) 로드. bars(symbol·date·close). */
export function loadUsPrices(db: Database, symbols: string[], fromDate: string): Map<string, PriceBar[]> {
  const out = new Map<string, PriceBar[]>();
  if (!symbols.length) return out;
  const ph = symbols.map(() => '?').join(',');
  const rows = db.query(
    `SELECT symbol, date, close FROM bars WHERE symbol IN (${ph}) AND date >= ? AND close > 0 ORDER BY symbol, date ASC`,
  ).all(...symbols, fromDate) as Array<{ symbol: string; date: string; close: number }>;
  for (const r of rows) {
    let arr = out.get(r.symbol);
    if (!arr) { arr = []; out.set(r.symbol, arr); }
    arr.push({ date: r.date, close: r.close });
  }
  return out;
}

/** N일 전 날짜(YYYY-MM-DD·UTC). prices 로드 범위 산정용. */
function daysAgo(now: string, days: number): string {
  const ms = Date.parse(`${now.slice(0, 10)}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ★ KR 섹터 매력도 3 window 계산 + 저장. screener.db prices 재사용. Never throws
 *  (fail-soft·store 실패 삼킴). 반환 = {window: scores} 요약. */
export function computeAndStoreKrSectors(
  now: string, opts: { dbPath?: string; granularity?: SectorGranularity } = {},
): Record<SectorWindow, SectorScore[]> {
  const result: Record<SectorWindow, SectorScore[]> = { daily: [], weekly: [], monthly: [] };
  const path = opts.dbPath ?? SCREENER_DB_PATH;
  if (!existsSync(path)) return result;
  const codes = Object.values(KR_CHAINS).flatMap(subs => Object.values(subs).flat());
  const from = daysAgo(now, 45); // monthly(30일)+여유.
  let db: Database | null = null;
  try {
    db = openSectorDb(path);  // sector_scores 테이블 생성 + prices 읽기·저장 단일 커넥션.
    const prices = loadPricesForCodes(db, codes, from);
    for (const window of ALL_WINDOWS) {
      const scores = computeSectorScores(prices, KR_CHAINS, { market: 'KR', window, now, granularity: opts.granularity });
      result[window] = scores;
      try { saveSectorScores(db, now.slice(0, 10), scores); } catch { /* fail-soft */ }
    }
  } catch { /* fail-soft */ }
  finally { db?.close(); }
  return result;
}

/** ★ US 섹터 매력도 3 window 계산 + 저장. us_pulse.db bars(SPDR 11+지수·로컬) 읽고
 *  screener.db sector_scores 저장. 각 ETF=1섹터 → momOnly(breadth 노이즈). Never throws. */
export function computeAndStoreUsSectors(
  now: string, opts: { srcPath?: string; storePath?: string } = {},
): Record<SectorWindow, SectorScore[]> {
  const result: Record<SectorWindow, SectorScore[]> = { daily: [], weekly: [], monthly: [] };
  const src = opts.srcPath ?? US_PULSE_DB_PATH;
  const storePath = opts.storePath ?? SCREENER_DB_PATH;
  if (!existsSync(src)) return result;
  const chains = usSectorChains(SECTOR_ETFS, ANCHOR_ETFS);
  const symbols = Object.values(chains).flatMap(subs => Object.values(subs).flat());
  const from = daysAgo(now, 45);
  let srcDb: Database | null = null, store: Database | null = null;
  try {
    srcDb = new Database(src, { readonly: true });
    const prices = loadUsPrices(srcDb, symbols, from);
    store = openSectorDb(storePath);
    for (const window of ALL_WINDOWS) {
      const scores = computeSectorScores(prices, chains, { market: 'US', window, now, minN: 1, momOnly: true, granularity: 'category' });
      result[window] = scores;
      try { saveSectorScores(store, now.slice(0, 10), scores); } catch { /* fail-soft */ }
    }
  } catch { /* fail-soft */ }
  finally { srcDb?.close(); store?.close(); }
  return result;
}
