// ── Trade Blackboard — 계약 에이전트 의도 공유 상태판 (2026-07-10 · C1) ──────────
//
// PLAN-trade-coordinator-mission C1. 두 매매 브레인(규칙 사이클·LLM 레버리지 에이전트)은
// 별도 스폰 프로세스라 서로의 의도를 모른다. 각 계약 에이전트가 "이번 사이클에 원하는 목표
// 포지션(TargetLeg[])"을 이 공유 상태판(SQLite·프로세스 간)에 제출하면, C2 오케스트레이터가
// 전체를 모아 조망·밸런싱한다. "에이전트 간 교류"의 안전한 형태(peer 직접협상 X·수렴 허브).
//
// C1 은 제출/조회 인프라만 — 밸런싱·집행은 C2/C3. agent-source seam 재사용(provenance·trust).
// 매매 동작 불변: 사이클은 기존 집행 경로 그대로 두고, 제출은 fail-soft 부수효과로만 추가.

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TargetLeg } from './trade-strategy.js';
import { stampProvenance, type SignalSource, type SourceOrigin } from './agent-source.js';
import { recordOpsEventSafe } from './ops-log.js';
import { conatusPath } from './conatus-data-dir.js';

export const TRADE_BLACKBOARD_DB_PATH = conatusPath('trade_blackboard.db');

export interface TradeIntentEntry {
  sourceId: string;
  origin: SourceOrigin;
  trust: number;
  contract?: string;      // 사람가독 계약명(삼성 캡스톤·한국 레버 등)
  targets: TargetLeg[];   // 목표 포지션 legs
  rationale?: string;
  regime?: string;        // 제출 당시 국면 스냅샷
  runId?: string;         // 사이클 run 추적
  /** ★ D2 기회 강도(0~1) — 이번 사이클 이 계약의 확신도. 오케스트레이터 동적 자금 배분
   *  입력(기회 큰 곳에 자금 tilt). LLM confidence·국면 강도. 부재 시 중립(0.5) 취급. */
  conviction?: number;
  ts: string;             // ISO
}

export function openTradeBlackboardDb(path: string = TRADE_BLACKBOARD_DB_PATH): Database {
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS trade_intents(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    source_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    trust REAL NOT NULL,
    contract TEXT,
    targets_json TEXT NOT NULL,
    rationale TEXT,
    regime TEXT,
    run_id TEXT,
    conviction REAL
  )`);
  // 하위호환 — 기존 DB 에 conviction 컬럼 없으면 추가(fail-soft).
  try { db.run(`ALTER TABLE trade_intents ADD COLUMN conviction REAL`); } catch { /* 이미 있음 */ }
  db.run(`CREATE INDEX IF NOT EXISTS idx_intents_source_ts ON trade_intents(source_id, ts DESC)`);
  return db;
}

export interface SubmitIntentInput {
  contract?: string;
  targets: TargetLeg[];
  rationale?: string;
  regime?: string;
  runId?: string;
  conviction?: number;   // 0~1 기회 강도(동적 배분 입력)
  now?: Date;
}

/** 계약 에이전트가 목표 포지션(의도)을 공유 상태판에 제출. append(이력 보존)·provenance 스탬프. */
export function submitIntent(db: Database, source: SignalSource, input: SubmitIntentInput): TradeIntentEntry {
  const now = input.now ?? new Date();
  const prov = stampProvenance(source, now.toISOString());
  db.run(
    `INSERT INTO trade_intents(ts, source_id, origin, trust, contract, targets_json, rationale, regime, run_id, conviction)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [prov.receivedAt, source.id, source.origin, source.trust,
      input.contract ?? null, JSON.stringify(input.targets),
      input.rationale ?? null, input.regime ?? null, input.runId ?? null,
      input.conviction ?? null],
  );
  // Ops 관측(P0) — 계약 루프 에이전트가 이번 사이클에 blackboard 로 의도를 제출한 사실을
  //   감사로그에 심는다(sourceId=루프 신원). "각 계약이 뭘·얼마 conviction 으로 원했나". fail-soft.
  recordOpsEventSafe({
    entityType: 'loop', entityId: source.id, event: 'cycle_end', toState: 'submitted',
    actor: 'cycle', rationale: input.rationale?.slice(0, 160) ?? input.contract,
    refs: {
      contract: input.contract, legs: input.targets.length,
      conviction: input.conviction, regime: input.regime,
      ...(input.runId ? { runId: input.runId } : {}),
    },
    now: () => now.toISOString(),
  });
  return {
    sourceId: source.id, origin: source.origin, trust: source.trust,
    ...(input.contract ? { contract: input.contract } : {}),
    targets: input.targets,
    ...(input.rationale ? { rationale: input.rationale } : {}),
    ...(input.regime ? { regime: input.regime } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.conviction != null ? { conviction: input.conviction } : {}),
    ts: prov.receivedAt,
  };
}

interface IntentRow {
  ts: string; source_id: string; origin: string; trust: number;
  contract: string | null; targets_json: string; rationale: string | null;
  regime: string | null; run_id: string | null; conviction: number | null;
}

function rowToEntry(r: IntentRow): TradeIntentEntry {
  let targets: TargetLeg[] = [];
  try { targets = JSON.parse(r.targets_json) as TargetLeg[]; } catch { targets = []; }
  return {
    sourceId: r.source_id, origin: r.origin as SourceOrigin, trust: r.trust,
    ...(r.contract ? { contract: r.contract } : {}),
    targets,
    ...(r.rationale ? { rationale: r.rationale } : {}),
    ...(r.regime ? { regime: r.regime } : {}),
    ...(r.run_id ? { runId: r.run_id } : {}),
    ...(r.conviction != null ? { conviction: r.conviction } : {}),
    ts: r.ts,
  };
}

/** 소스별 최신 의도 수집(오케스트레이터 입력·C2). maxAgeMin 넘은 stale 은 제외(fail-safe). */
export function latestIntents(db: Database, opts: { maxAgeMin?: number; now?: Date } = {}): TradeIntentEntry[] {
  const now = opts.now ?? new Date();
  const rows = db.query(
    `SELECT ts, source_id, origin, trust, contract, targets_json, rationale, regime, run_id, conviction
       FROM trade_intents t
      WHERE ts = (SELECT MAX(ts) FROM trade_intents t2 WHERE t2.source_id = t.source_id)
      ORDER BY source_id`,
  ).all() as IntentRow[];
  const entries = rows.map(rowToEntry);
  if (opts.maxAgeMin == null) return entries;
  const cutoff = now.getTime() - opts.maxAgeMin * 60_000;
  return entries.filter(e => new Date(e.ts).getTime() >= cutoff);
}

/** 오래된 의도 정리(이력 상한). keepDays 이전 행 삭제. fail-soft. */
export function pruneIntents(db: Database, keepDays = 14, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  try { return db.run(`DELETE FROM trade_intents WHERE ts < ?`, [cutoff]).changes; } catch { return 0; }
}
