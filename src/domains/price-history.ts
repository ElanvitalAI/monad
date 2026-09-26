// ── 시세 롤링 이력 — 1h 모멘텀(급락/급등) 감지용 (2026-07-15 대표 지시) ──────────
//
// price-guard 가 매 사이클 감시 종목 시세를 여기 append 하면, "1시간 대비" 변동을 계산할 수 있다.
// 기존 changePct 는 전일종가(previousClose) 기준이라 장중 급락/급등을 못 잡는다(대표 지적).
// 무포지션 종목도 감시 대상 — 움직임 신호는 보유 여부와 무관(매도 아님·정보성 알림).
//
// 저장: ~/.elanous/conatus/price_history.db · (symbol, ts, price). 바운디드(오래된 행 prune).

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { conatusPath } from './conatus-data-dir.js';

export const PRICE_HISTORY_DB_PATH = conatusPath('price_history.db');

export function openPriceHistoryDb(path: string = PRICE_HISTORY_DB_PATH): Database {
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS price_history (
    symbol TEXT NOT NULL, ts TEXT NOT NULL, price REAL NOT NULL,
    PRIMARY KEY (symbol, ts)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ph_symbol_ts ON price_history(symbol, ts)`);
  return db;
}

/** 시세 1건 적재(멱등 — 같은 symbol+ts 무시). */
export function recordPrice(db: Database, symbol: string, price: number, tsIso: string): void {
  db.prepare(`INSERT OR IGNORE INTO price_history (symbol, ts, price) VALUES (?, ?, ?)`)
    .run(symbol, tsIso, price);
}

export interface MomentumResult {
  /** 1h(windowMin) 전 대비 변동률 %. */
  pct: number;
  /** 기준 시점 시세. */
  refPrice: number;
  /** 기준 시점이 실제로 몇 분 전인지(허용창 내 최근접). */
  refAgeMin: number;
}

/**
 * windowMin(기본 60) 전 시세 대비 모멘텀. 허용창(toleranceMin) 내 최근접 과거 시세를 기준으로.
 * 이력 부족(기준 시세 없음)이면 null — 첫 관측/장초반은 판정 안 함(fail-soft).
 */
export function computeMomentum(
  db: Database, symbol: string, nowMs: number, nowPrice: number,
  windowMin = 60, toleranceMin = 25,
): MomentumResult | null {
  const targetMs = nowMs - windowMin * 60_000;
  const lo = new Date(targetMs - toleranceMin * 60_000).toISOString();
  const hi = new Date(targetMs + toleranceMin * 60_000).toISOString();
  const targetIso = new Date(targetMs).toISOString();
  // 목표 시점(1h 전)에 가장 가까운 과거 시세 1건(허용창 내).
  const row = db.prepare(
    `SELECT ts, price FROM price_history
     WHERE symbol = ? AND ts BETWEEN ? AND ?
     ORDER BY ABS(strftime('%s', ts) - strftime('%s', ?)) ASC LIMIT 1`,
  ).get(symbol, lo, hi, targetIso) as { ts: string; price: number } | null;
  if (!row || !(row.price > 0)) return null;
  const pct = ((nowPrice - row.price) / row.price) * 100;
  const refAgeMin = Math.round((nowMs - Date.parse(row.ts)) / 60_000);
  return { pct, refPrice: row.price, refAgeMin };
}

/** 오래된 행 정리(기본 48h 보관) — 바운디드 저장. */
export function pruneOldPrices(db: Database, nowMs: number, keepHours = 48): number {
  const cutoff = new Date(nowMs - keepHours * 3_600_000).toISOString();
  const r = db.prepare(`DELETE FROM price_history WHERE ts < ?`).run(cutoff);
  return r.changes;
}
