#!/usr/bin/env bun
// ── Signal Outcome Cycle — 사후수익률 검증 B3 (2026-07-11·Goodhart) ─────────────
//
// 집행된 신호(paper/live-filled)의 horizon(3일) 경과분을 실제 forward 시세로 방향 검증 →
// hit-rate 를 A6 resolution metrics 에 융합(자기선언 아닌 실성과). READ-ONLY·무매매. 크론=일1회.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { runOutcomeCheck, signalOutcomeToEvent, learnedTrustFactors } from '../src/domains/signal-outcome.js';
import { openSurfaceEventsDb, recordEvent } from '../src/domains/surface-events.js';
import { fetchTossQuote } from '../src/domains/toss-quote.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';
import { debug } from '../src/debug/log.js';

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/signal_outcome_cycle.log');
const HORIZON = Number(process.env.SIGNAL_OUTCOME_HORIZON_DAYS || 3);

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

const tossCode = (s: string): string => s.replace(/\.(KO|KS|KQ|US)$/i, '').trim();
const priceOf = (symbol: string): number | null => {
  try { return fetchTossQuote(tossCode(symbol))?.last ?? null; } catch { return null; }
};

function main(): void {
  const pool = new SignalPool();
  const sdb = openSurfaceEventsDb();          // ★ H1 — 사후결과를 기억(해마)에 각인
  let engraved = 0;
  try {
    const r = runOutcomeCheck(pool, {
      priceOf, horizonDays: HORIZON,
      onOutcome: (rec) => { try { recordEvent(sdb, signalOutcomeToEvent(rec)); engraved += 1; } catch { /* 각인 실패 무영향 */ } },
    });
    const hr = pool.outcomeHitRate();
    // ★ H2 — 소스별 hit-rate → pending 신호 trust 재가중(적응형 신뢰 되먹임·bounded·매매 무접촉).
    const factors = learnedTrustFactors(pool.sourceHitRates());
    const reweight = pool.applyLearnedTrust(factors);
    log(`사후검증: 대상 ${r.checked} · 검증 ${r.verified}(정확 ${r.correct}) · 각인 ${engraved} · 학습가중 ${reweight.adjusted} · 보류 ${r.skipped} · 누적 hit-rate ${(hr.hitRate * 100).toFixed(0)}%(${hr.correct}/${hr.verified})`);
    try { debug.log('signal.outcome', 'cycle', { verified: r.verified, correct: r.correct, engraved, reweighted: reweight.adjusted, factors, hitRate: Math.round(hr.hitRate * 100) }); } catch { /* fail-open */ }
  } finally { pool.close(); sdb.close(); }
}

try { main(); } catch (e) { log(`outcome 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
