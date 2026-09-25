#!/usr/bin/env bun
// ── Signal Dig Cycle — 반응형 렌즈 B1 (2026-07-11) ─────────────────────────────
//
// pool 이 확정한 critical(S4/adjust) 신호에 dig-engine(runDig) 심화 디깅을 렌즈 깊이로 호출·
// verdict 를 pool 에 환류(라우터 알림 보강). §12.4 반응형 — 고정 크론 아니라 pool 트리거.
// READ-ONLY 분석·무매매. 크론=schedule 도구(gate2 뒤).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { runReactiveLens } from '../src/domains/signal-dig.js';
import { openSignalsDb } from '../src/domains/breaking-signals.js';
import { ensureDigTables, runDig, type DigItem } from '../src/domains/dig-engine.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/signal_dig_cycle.log');
const LIMIT = Number(process.env.SIGNAL_DIG_LIMIT || 5);   // 런당 상한(dig 비용 바운드)

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

async function main(): Promise<void> {
  const pool = new SignalPool();
  const db = openSignalsDb();
  try {
    ensureDigTables(db);
    const dig = (item: DigItem) => runDig(db, item);   // dig-engine 재사용(공유 db·재귀 큐)
    const r = await runReactiveLens(pool, { dig, limit: LIMIT });
    log(`반응형 렌즈: 대상 ${r.processed} · 심화 ${r.dug} · 실패 ${r.failed}`);
    for (const it of r.items) log(`  ▶ ${it.eventId} [${it.confidence}]: ${it.head}`);
  } finally { db.close(); pool.close(); }
}

main().catch((e) => { log(`signal-dig 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
