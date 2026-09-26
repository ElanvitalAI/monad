#!/usr/bin/env bun
// ── Signal Gate2 Cycle — 적응형 투자 A2 (2026-07-11) ────────────────────────
//
// 1차가 critical(S3+)로 올린 미판정 신호를 2차(luna·저비용 심층)로 판단·기록.
// 전량 아닌 critical만이라 저비용. 알림/집행 없음(판정만·라우팅은 A3). 크론=schedule 도구.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { runGate2, gate2AlertPriority } from '../src/domains/signal-gate2.js';
import { loadMarketPosture } from '../src/domains/market-posture-store.js';
import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';

const LOG = join(homedir(), '.elanous/conatus/signal_gate2_cycle.log');
const LIMIT = Number(process.env.GATE2_LIMIT || 50);

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

async function main(): Promise<void> {
  // 게이팅 사유가 logs.db 에 닿게 sink 등록(별도 스폰이라 데몬 상속 없음). fail-open.
  await registerStandaloneLogSink('scheduler');
  const pool = new SignalPool();
  // Read-only context only: unavailable/stale posture never selects a trade direction or blocks new buys.
  const posture = loadMarketPosture();
  try {
    const r = await runGate2(pool, { limit: LIMIT, posture });
    log(`2차 판정 ${r.judged} · 확정(critical) ${r.confirmed} · 오탐(강등) ${r.falsePositive} · 확정누적 ${pool.listConfirmed(1000).length} · posture DEFCON ${posture?.defcon ?? 'unavailable'} · 검토우선순위 ${gate2AlertPriority(posture)} · freshness ${posture?.freshness.status ?? 'UNAVAILABLE'}`);
  } finally { pool.close(); }
}

main().catch((e) => { log(`gate2 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
