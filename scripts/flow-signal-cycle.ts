#!/usr/bin/env bun
// ── Flow Signal Cycle — 적응형 투자 수급 신호 (2026-07-11) ──────────────────────
//
// kr-investor-ingest 가 채운 screener.db/investor(외국인·기관 순매매 랭킹)에서 **포커스/반도체
// 관련 종목의 대량 수급**을 discrete Signal 로 pool 에 적재 → 과다신호 게이팅(gate2) → 라우터/
// 코디네이터 조율. 그대로 알림 복직이 아니라 신규 버전(source=market·provenance).
//
// 안전: READ-ONLY·무매매. 포커스/반도체 매핑 종목만 신호화(랭킹 전량 아님·noise 억제). 랭킹
//   진입 자체가 notable(상위 순매매)이라 curated S3(대량은 S4) → gate2 가 확정/강등.

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { SignalPool } from '../src/domains/signal-pool.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

ensureCronNodePath();

const LOG = join(homedir(), '.monad/conatus/flow_signal_cycle.log');
const SCREENER = join(homedir(), '.monad/conatus/screener.db');
// 발행사명 → 티커. 포커스(삼성) + 반도체 매크로 관련(하이닉스·미매핑은 무시).
const NAME_TICKER: Record<string, string> = {
  '삼성전자': '005930.KO', 'SK하이닉스': '000660.KO',
};
// 대량 임계(순매매 수량 절대값). 이상=S4(긴급), 이하 랭킹진입=S3.
const HEAVY_QTY = 500_000;

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* fail-soft */ }
}

interface InvRow { date: string; type: string; name: string; chg_pct: number | null; net_qty: number | null }

function main(): void {
  let rows: InvRow[] = [];
  try {
    const db = new Database(SCREENER, { readonly: true });
    try {
      const latest = (db.query(`SELECT MAX(date) d FROM investor`).get() as { d: string | null })?.d;
      if (!latest) { log('investor 데이터 없음'); return; }
      rows = db.query(`SELECT date, type, name, chg_pct, net_qty FROM investor WHERE date = ?`).all(latest) as InvRow[];
      log(`최신 ${latest} · ${rows.length}행 · 포커스/반도체 필터`);
    } finally { db.close(); }
  } catch (e) { log(`screener 조회 실패: ${e instanceof Error ? e.message : String(e)}`); return; }

  const hits = rows.filter((r) => NAME_TICKER[r.name]);
  if (hits.length === 0) { log('포커스/반도체 종목 수급 진입 없음 — 무신호'); return; }

  const pool = new SignalPool();
  try {
    let n = 0;
    for (const r of hits) {
      const ticker = NAME_TICKER[r.name]!;
      const qty = r.net_qty ?? 0;
      const dir = qty >= 0 ? '순매수' : '순매도';
      const sev = Math.abs(qty) >= HEAVY_QTY ? 'S4' : 'S3';
      const res = pool.ingest({
        eventId: `flow:${r.date}:${r.type}:${r.name}`,
        source: 'market',
        asset: ticker,
        observedAt: `${r.date}T00:00:00Z`, collectedAt: new Date().toISOString(),
        origin: `수급/${r.type}`,
        trust: 0.85,
        severity: sev, severityReason: `${r.type} ${dir} ${Math.abs(qty).toLocaleString()}주`,
        dedupGroup: ticker,
        raw: `[수급·${r.type}] ${r.name}(${ticker}) ${dir} ${Math.abs(qty).toLocaleString()}주 (등락 ${r.chg_pct ?? '?'}%). 포지션 영향 점검.`,
      });
      if (res.inserted) n += 1;
    }
    log(`수급 신호 적재 ${n}건(${hits.length}중 신규) → 2차 게이트 대기`);
  } finally { pool.close(); }
}

try { main(); } catch (e) { log(`flow-signal 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
