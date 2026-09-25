#!/usr/bin/env bun
// ── Regime Refresh Cycle — 적응형 투자 (2026-07-11) ────────────────────────────
//
// clean-slate 로 매매 사이클(M3 국면 재계산)이 해제되며 regime.db 가 stale → 게이트체인의
// 국면 게이트가 낡은 국면으로 판단하던 갭을 해소. **그대로 복직이 아니라 신규 버전**:
//   ① 국면 벡터 재계산·저장(fresh context — 게이트체인/코디네이터가 읽음)
//   ② **국면 전환 시 pool 에 discrete Signal 생성(source=regime)** → 과다신호 게이팅(2차 luna)
//      → 라우터/코디네이터가 조망·조율. 상태(context) + 사건(signal) 이원.
//
// 안전: READ-ONLY 계산·무매매. 전환 edge 만 신호화(안정 구간 무발사·dedup). curated S3 로
//   적재(gate1 우회·gate2 가 확정/강등). source=regime·trust=1.0(내부 계산·provenance).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { openRegimeDb, latestRegimeVector, computeAndStoreRegime } from '../src/domains/regime-store.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/regime_refresh_cycle.log');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

async function main(): Promise<void> {
  const now = new Date().toISOString();

  // 이전 라벨(전환 edge 판정용) — 재계산 전 스냅샷.
  let prevLabel = '';
  try { const db = openRegimeDb(); prevLabel = latestRegimeVector(db)?.regimeLabel ?? ''; db.close(); } catch { /* fail-soft */ }

  // ① fresh 재계산·저장(live fetchers).
  const v = await computeAndStoreRegime(now);
  const changed = prevLabel !== '' && v.regimeLabel !== prevLabel;
  log(`국면 ${prevLabel || '(초기)'}→${v.regimeLabel} comp=${v.composite} transition=${v.transition}${changed ? ' ·라벨변경' : ''}`);

  // ② 전환 edge → pool Signal(source=regime·curated S3). 안정 구간은 무발사.
  if (v.transition || changed) {
    const pool = new SignalPool();
    try {
      const r = pool.ingest({
        eventId: `regime:${v.asOf}`,
        source: 'regime',
        observedAt: v.asOf,
        collectedAt: now,
        origin: 'regime-synth',
        trust: 1.0,                       // 내부 계산·provenance(코디네이터 가중)
        severity: 'S3',                   // curated 고심각(gate1 우회) → gate2 가 확정/강등
        severityReason: `국면 전환 ${prevLabel || '?'}→${v.regimeLabel}`,
        dedupGroup: 'regime-transition',
        raw: `국면 전환: ${prevLabel || '(초기)'} → ${v.regimeLabel} (composite ${v.composite}${v.transition ? ' · 다축 부호전환' : ''}). 포트폴리오 국면 재평가 필요.`,
      });
      log(`  ▶ 국면 전환 신호 적재(${r.inserted ? 'new' : 'dup'}) → 2차 게이트 대기`);
    } finally { pool.close(); }
  }
}

main().catch((e) => { log(`regime-refresh 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
