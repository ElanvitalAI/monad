#!/usr/bin/env bun
// ── Signal Pool Cycle — 적응형 투자 A1b (2026-07-11) ────────────────────────
//
// 크론 사이클: 기존 수집 DB(community_buzz·breaking_signals) 최근 신호를 signal pool 로
// 브릿지 적재(멱등) → 1차 게이트(무비용 규칙)로 전량 severity 분류 → 롤업 로그.
// 매매/집행/발송 없음(적재+분류만·안전). 2차·라우팅·알림은 후속 A2·A3.
//
// 등록: monad schedule create (schedule 도구·기억 정합).

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { runGate1 } from '../src/domains/signal-gate1.js';
import {
  buzzPostToSignal, breakingSignalToSignal, aggregateBearish, bearishFloodSignals,
  type BearishBuzzRow,
} from '../src/domains/signal-bridge.js';
import { loadMandate } from '../src/domains/trade-mandate.js';
import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';

const CONATUS = join(homedir(), '.monad/conatus');
const LOG = join(CONATUS, 'signal_pool_cycle.log');
const RECENT = 400;   // 사이클당 최근 N건(멱등 ingest 라 중복 안전)

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

/** 소스 DB 에서 최근 rows 를 읽어 매퍼로 pool 에 적재(fail-soft). 반환=신규 적재 수. */
function bridge(pool: SignalPool, dbName: string, table: string, map: (r: any) => any): number {
  const path = join(CONATUS, dbName);
  if (!existsSync(path)) { log(`skip ${dbName} (없음)`); return 0; }
  let inserted = 0;
  const db = new Database(path, { readonly: true });
  db.run('PRAGMA busy_timeout = 2000');
  try {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ts DESC LIMIT ?`).all(RECENT) as any[];
    for (const r of rows) {
      try { if (pool.ingest(map(r)).inserted) inserted += 1; } catch { /* 개별 row 실패 무시 */ }
    }
  } catch (e) {
    log(`bridge ${dbName}.${table} 실패: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
  } finally { db.close(); }
  return inserted;
}

/** focus/보유 티커의 반복 하락 버즈 급증 → 보호신호 후보 합성·적재(대표 2026-07-15·L1).
 *  community_buzz.db 에서 신뢰성 있는(non-spam·importance≥4) 하락 정서 글을 focus 티커별 집계.
 *  시간버킷당 1건 멱등이라 재수집·재사이클 안전. 반환=신규 적재 수. */
function bridgeBearishFloods(pool: SignalPool, focusAssets: string[]): number {
  const path = join(CONATUS, 'community_buzz.db');
  if (!existsSync(path) || focusAssets.length === 0) return 0;
  const db = new Database(path, { readonly: true });
  db.run('PRAGMA busy_timeout = 2000');
  try {
    const rows = db.prepare(
      `SELECT tickers, sentiment, importance, title, fetch_ts FROM buzz_posts
       WHERE spam=0 AND importance>=4 AND sentiment IS NOT NULL AND sentiment <= -0.3
         AND tickers IS NOT NULL AND fetch_ts > datetime('now','-3 hours')`,
    ).all() as BearishBuzzRow[];
    const aggs = aggregateBearish(rows, focusAssets);
    const hourBucket = new Date().toISOString().slice(0, 13);   // YYYY-MM-DDTHH (시간버킷 멱등)
    const floods = bearishFloodSignals(aggs, { hourBucket });
    let inserted = 0;
    for (const f of floods) {
      try { if (pool.ingest(f).inserted) { inserted += 1; log(`bearish-flood ${f.asset}: ${f.raw.slice(0, 80)}`); } }
      catch { /* 개별 실패 무시 */ }
    }
    return inserted;
  } catch (e) {
    log(`bearish-flood 감지 실패: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
    return 0;
  } finally { db.close(); }
}

async function main(): Promise<void> {
  // 1차 게이팅 사유(S2+ 승격)가 logs.db 에 닿게 sink 등록(별도 스폰이라 데몬 상속 없음). fail-open.
  await registerStandaloneLogSink('scheduler');
  const focusAssets = (() => {
    try { return loadMandate().focusSymbols; } catch { return []; }
  })();
  const pool = new SignalPool();
  try {
    const nBuzz = bridge(pool, 'community_buzz.db', 'buzz_posts', buzzPostToSignal);
    const nNews = bridge(pool, 'breaking_signals.db', 'signals', breakingSignalToSignal);
    const nFlood = bridgeBearishFloods(pool, focusAssets);   // L1 — focus 하락 급증 합성
    // 전량 분류 — 미분류가 없을 때까지 배치 반복(무비용 규칙). focus 는 L1/L4 판정에 주입.
    const total = { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0 };
    let classified = 0;
    for (let i = 0; i < 100; i += 1) {
      const gate = await runGate1(pool, { limit: 500, focusAssets });
      if (gate.classified === 0) break;
      classified += gate.classified;
      for (const k of ['S0', 'S1', 'S2', 'S3', 'S4'] as const) total[k] += gate.bySeverity[k];
    }
    log(`적재 community=${nBuzz} news=${nNews} flood=${nFlood} · 1차분류 ${classified} (S0=${total.S0} S1=${total.S1} S2=${total.S2} S3=${total.S3} S4=${total.S4}) · pool총 ${pool.count()}`);
  } finally { pool.close(); }
}

main().catch((e) => { log(`cycle 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
