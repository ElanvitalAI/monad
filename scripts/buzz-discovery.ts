#!/usr/bin/env bun
// ── 버즈 종목 발굴 (P4) · 장중 주기 크론 · 2026-07-09 ─────────────────────────
//
// emergence → dig_queue 적재(기존 dig-runner 심층분석) + 매력도 조회 → 발굴 리포트.
// 매매 격리(read-only). 등록: elanous schedule create --cron '0 10,14 * * 1-5'
//   --command 'scripts/buzz-discovery.ts'

import { ensureCronNodePath } from '../src/domains/cron-path.js';
import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';

const unknownFlag = unknownCronFlag(process.argv, { boolean: ['--to-pool'], valued: [] });
if (unknownFlag) {
  console.error(`⛔ 모르는 플래그: ${unknownFlag}`);
  process.exit(1);
}
ensureCronNodePath();

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openBuzzDb } from '../src/domains/community-buzz/store.js';
import { discoveryCandidates, enqueueForumDiscovery, lookupAttractiveness, formatDiscoveryReport, type Attractiveness } from '../src/domains/community-buzz/discovery.js';
import { ensureDigTables } from '../src/domains/dig-engine.js';
import { openSignalsDb } from '../src/domains/breaking-signals.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';

const LOG = join(homedir(), '.elanous/conatus/buzz_discovery.log');
// ★ B5 신규 버전: --to-pool 이면 발굴 종목을 signal pool 로(발송 대신·게이트가 알림 독점).
const TO_POOL = process.argv.includes('--to-pool');
function log(s: string): void {
  console.log(s);
  try { if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* */ }
}

async function main(): Promise<void> {
  log('=== buzz-discovery 시작 ===');
  const buzzDb = openBuzzDb();
  try {
    const cands = discoveryCandidates(buzzDb, { hours: 24, minRatio: 2.5, limit: 8 });
    if (cands.length === 0) { log('급부상 종목 없음 — 종료'); return; }
    log(`급부상 ${cands.length}종: ${cands.map(c => `${c.ticker}(x${c.ratio})`).join(' ')}`);

    // ① dig_queue 적재(기존 dig-runner 가 심층분석)
    const digDb = openSignalsDb();
    let enq = 0;
    try { ensureDigTables(digDb); enq = enqueueForumDiscovery(digDb, cands, new Date().toISOString()); } finally { digDb.close(); }
    log(`dig_queue 적재 ${enq}건(dig-runner 심층분석 대기)`);

    // ② 매력도 최신 스코어 조회(read-only)
    const attract = new Map<string, Attractiveness | null>();
    for (const c of cands) attract.set(c.ticker, lookupAttractiveness(c.ticker));
    const scored = [...attract.values()].filter(Boolean).length;
    log(`매력도 조회: ${scored}/${cands.length} 채점됨`);

    // ③ B5 신규 버전: --to-pool 이면 발굴 종목을 signal pool 에 적재(발송 대신·게이트가 알림 독점).
    if (TO_POOL) {
      const { SignalPool } = await import('../src/domains/signal-pool.js');
      const pool = new SignalPool();
      try {
        const nowIso = new Date().toISOString();
        let n = 0;
        for (const c of cands) {
          const asset = /^\d{6}$/.test(c.ticker) ? `${c.ticker}.KO` : c.ticker;
          const a = attract.get(c.ticker);
          const res = pool.ingest({
            eventId: `buzzdisc:${nowIso.slice(0, 10)}:${c.ticker}`,
            source: 'community', asset,
            observedAt: nowIso, collectedAt: nowIso,
            origin: 'fmkorea/발굴', trust: 0.5,
            // 심각도 미지정 → 1차 게이트가 커뮤니티 규칙으로 분류(단일출처 상한).
            dedupGroup: asset,
            raw: `[버즈 발굴] ${c.ticker} 급부상(x${c.ratio})${a ? ` · 매력도 ${a.signal ?? '?'}` : ''}. 신규 관심 종목.`,
          });
          if (res.inserted) n += 1;
        }
        log(`pool 적재 ${n}건(발굴 종목 → 1차 게이트) · 발송 억제`);
      } finally { pool.close(); }
    } else {
      // 기존 동작 — 발굴 리포트 발송(매매 격리·HITL)
      const report = formatDiscoveryReport(cands, attract);
      if (report) {
        let ok = false;
        try { ok = sendOutbound(report, 'report'); } catch (e) { log(`리포트 발송 오류: ${e instanceof Error ? e.message : String(e)}`); }
        log(`🔎 발굴 리포트 ${ok ? '발송' : '실패/보류'}`);
      }
    }
    log('=== buzz-discovery 완료 ===');
  } finally { buzzDb.close(); }
}

main().catch((e) => { log(`치명 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
