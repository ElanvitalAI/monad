#!/usr/bin/env bun
// ── Signal Resolution Cycle — 적응형 투자 A6 (2026-07-11) ──────────────────────
//
// 발굴형 해상도 루프(§12.4): 파이프라인 성과를 실측(A6a metrics)해 해상도 갭을 감지하고,
// 갭을 발굴 미션 씨앗(A6b)으로 변환해 인입한다. 씨앗=business(부작용 없는 리서치)라 A4c
// 자동수용(arming 시 status=armed·HITL 스킵). 산출=원인 분석 + 보강안 문서(무매매·무코드변경).
//
// ★ Goodhart 가드: 갭은 자기선언 아닌 pool 실측(오탐/커버리지/분포). 표본 부족 시 미생성.
// ★ dedup: 씨앗 제목 안정 → intake 가 goal title 로 중복 방지(재사이클 홍수 없음). 크론=주 1회.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { computeMetrics, detectGaps, type ResolutionGap } from '../src/domains/signal-metrics.js';
import { gapsToSeeds } from '../src/domains/signal-discovery.js';
import { intakeSeedsAsMissions } from '../src/autopilot/discovery-intake.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/signal_resolution_cycle.log');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

async function main(): Promise<void> {
  const pool = new SignalPool();
  let gaps: ResolutionGap[];
  try {
    const m = computeMetrics(pool.metricsSnapshot());
    gaps = detectGaps(m);
    log(`메트릭 fp=${(m.falsePositiveRate * 100).toFixed(0)}% cov=${(m.gate2Coverage * 100).toFixed(0)}% critShare=${(m.criticalShare * 100).toFixed(0)}% · 갭 ${gaps.length}(${gaps.map((g) => g.kind).join(',') || '-'})`);
  } finally { pool.close(); }

  if (gaps.length === 0) { log('갭 없음 — 발굴 미션 생성 skip'); return; }

  const seeds = gapsToSeeds(gaps);
  const r = await intakeSeedsAsMissions(seeds);   // business → A4c 자동수용(arming 시 armed·dedup)
  log(`발굴 미션 인입 ${r.created}(자동수용 ${r.autoAccepted}) · dedup skip ${r.skipped}`);
  for (const mm of r.missions) log(`  ▶ ${mm.status} ${mm.goal}`);
}

main().catch((e) => { log(`resolution 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
