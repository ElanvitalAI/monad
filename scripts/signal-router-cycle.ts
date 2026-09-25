#!/usr/bin/env bun
// ── Signal Router Cycle — 적응형 투자 A3 (2026-07-11) ──────────────────────────
//
// 2차가 확정(confirmed critical)한 미라우팅 신호를 즉시(interrupt)/배치(batch)로 라우팅.
// interrupt = 스케줄 이탈 즉시 알림(발신 채널). batch = 다이제스트 대기(signal-digest-cycle).
//
// ★ shadow 기본(무발송·DB 무변경·미리보기 로그만). `--live` 플래그로만 실제 발송+상태 소진.
//   첫 라이브는 shadow 로 라이브 pool 검증 → 대표 확인 후 schedule 을 --live 로 업데이트.
//
// 안전: 무매매(알림만·mandate 정지). freshness 게이트로 stale 확정 즉시-알림 억제. 크론=schedule 도구.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { runRouter } from '../src/domains/signal-router.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { registerStandaloneLogSink } from '../src/domains/standalone-log-sink.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';
import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';

const unknownFlag = unknownCronFlag(process.argv, { boolean: ['--live'], valued: [] });
if (unknownFlag) {
  console.error(`⛔ 모르는 플래그: ${unknownFlag}`);
  process.exit(1);
}

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/signal_router_cycle.log');
const LIVE = process.argv.includes('--live');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

async function main(): Promise<void> {
  await registerStandaloneLogSink('scheduler');  // outbound.send 관측이 logs.db 에 닿게
  const pool = new SignalPool();
  try {
    const r = runRouter(pool, LIVE ? { send: sendOutbound } : {});
    log(`[${r.mode}] 라우팅 ${r.total} · interrupt ${r.interrupt}(발송 ${r.sent}) · batch ${r.batch} · stale강등 ${r.staleDowngraded} · 디깅유보 ${r.digDeferred}`);
    // shadow 는 발송 대신 즉시-알림 미리보기를 로그(대표 검증용).
    if (!LIVE) {
      for (const it of r.items.filter((x) => x.route === 'interrupt')) {
        log(`  ▶ [interrupt shadow] ${it.eventId}: ${it.preview.split('\n').slice(0, 3).join(' / ')}`);
      }
    }
  } finally { pool.close(); }
}

main().catch((e) => { log(`router 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
