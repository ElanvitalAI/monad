#!/usr/bin/env bun
// ── OOS 검증 배치 (A1 · 2026-07-08) ───────────────────────────────────────
//
// 과거 CONFIRMED 페이퍼 체결(horizon 경과) → 실제 forward 종가 대조 → 게이트
// 신뢰도(hitRate·IC) 실증. confirmed 4/4 과최적화 경보의 실데이터 검증.
// 사용: bun scripts/oos-verify.ts [--horizons 5,20]. 크론(장마감 후) 권장.
// 결과: backtest.db oos_checks. 로그: ~/.monad/conatus/oos_verify.log.

import { existsSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openBacktestDb, BACKTEST_DB_PATH } from '../src/domains/backtest-store.js';
import { loadDueFills, computeOOSChecks, insertOOSChecks, oosStats } from '../src/domains/backtest-oos.js';
import { SCREENER_DB_PATH, US_PULSE_DB_PATH } from '../src/domains/sector-store.js';

const LOG = join(homedir(), '.monad/conatus/oos_verify.log');
const log = (m: string): void => { try { appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch { /* */ } };

const arg = (f: string, d: string): string => { const i = process.argv.indexOf(f); return i >= 0 ? String(process.argv[i + 1]) : d; };
const horizons = arg('--horizons', '5,20').split(',').map(Number).filter(n => n > 0);
const now = new Date().toISOString();

if (!existsSync(BACKTEST_DB_PATH)) { console.log('backtest.db 없음'); process.exit(0); }

// forward 종가 — KR(6자리)=screener.db·US=us_pulse.db. fromDate 이후 horizon 거래일 후.
const screener = existsSync(SCREENER_DB_PATH) ? new Database(SCREENER_DB_PATH, { readonly: true }) : null;
const pulse = existsSync(US_PULSE_DB_PATH) ? new Database(US_PULSE_DB_PATH, { readonly: true }) : null;
function forwardClose(symbol: string, fromDate: string, horizon: number): number | null {
  const isKr = /^\d{6}$/.test(symbol);
  const db = isKr ? screener : pulse;
  if (!db) return null;
  const [table, col] = isKr ? ['prices', 'code'] : ['bars', 'symbol'];
  const rows = db.query(`SELECT close FROM ${table} WHERE ${col}=? AND date > ? ORDER BY date LIMIT ?`).all(symbol, fromDate, horizon) as Array<{ close: number }>;
  return rows.length >= horizon ? rows[rows.length - 1]!.close : null;   // horizon 거래일 경과분만
}

const db = openBacktestDb();
let totalInserted = 0;
for (const horizon of horizons) {
  const fills = loadDueFills(db, horizon, now);
  const checks = computeOOSChecks(fills, horizon, forwardClose);
  const n = insertOOSChecks(db, checks, now);
  totalInserted += n;
  log(`horizon ${horizon}: due ${fills.length} · checks ${checks.length} · inserted ${n}`);
}
const stats = oosStats(db, { sinceDays: 90, now });
db.close();
screener?.close(); pulse?.close();

log(`OOS 누적(90일): n=${stats.n} hitRate=${stats.hitRate.toFixed(3)} IC=${stats.ic.toFixed(3)} byHorizon=${JSON.stringify(stats.hitRateByHorizon)}`);
console.log(JSON.stringify({ inserted: totalInserted, stats }, null, 2));
