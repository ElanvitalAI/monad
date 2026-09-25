// ── 운영 이벤트 로그 (Ops Observability P0 · 2026-07-10) ────────────────────
//
// 문제: 오케스트레이터형 투자 루프(미션 → 3계약 루프 → blackboard → 오케스트레이터 →
// 집행)가 실전 arming 으로 돌지만, "지금 무엇이 왜 이 상태로 돌고 있나"를 추적할
// 감사로그가 없다. 미션/태스크 상태 전이는 silent update 고(왜 이 상태인지 불명),
// 오케스트레이션 결과(merge/alloc/budget)는 메모리에만 남고, 루프 사이클의 시작/끝도
// 머신용으로 기록되지 않는다(파일 텍스트 로그만).
//
// 해결: 상태 전이·사이클·오케스트레이션을 구조화 기록하는 전용 스토어 ops_events.db.
// autonomy-log(surface_events kind='autonomy') 패턴을 미러링하되, 고빈도 머신용
// 관측 이벤트는 발송원장(surface_events)을 오염시키지 않도록 별도 스토어로 분리한다
// (대표 결정 2026-07-10). 저빈도 중요 전이만 autonomy-log 로 브릿지 → self_recall 자동 회상.
//
// 거버넌스: 순수 기록(READ-ONLY 조회는 ops-status.ts). 매매/발송 로직과 무관. fail-soft —
// 기록 실패가 핵심 동작(미션 전이·매매 사이클)을 절대 막지 않는다.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { within } from '../time/db-window.js';

/** ops_events.db 정본 경로 — state-dir 존중(lazy · Phase B). prod=`~/.monad/ops_events.db`
 *  (무변경) · 격리 test=자기 루트. 종전 homedir 하드코딩은 test ops 이벤트가 prod 관측을
 *  오염시키던 근본(연합 대상도 아니라 prod ops_events.db 에 섞여 관측 왜곡). */
export function opsEventsDbPath(): string {
  return join(monadStateRoot(), 'ops_events.db');
}

/** 관측 대상 엔티티 축 — 4계층(미션·태스크·루프·오케스트레이터) + 세션 패브릭. */
export type OpsEntityType = 'mission' | 'task' | 'loop' | 'orchestration' | 'session';

/** 이벤트 종류 — 상태 전이(created/status_change/blocked)와 실행(cycle_start/end)과
 *  조율(merge/alloc)을 아우른다. */
export type OpsEventKind =
  | 'created' | 'status_change' | 'blocked'
  | 'cycle_start' | 'cycle_end'
  | 'merge' | 'alloc'
  | 'mission_linked';

/** 전이를 유발한 주체 — "누가 이 상태를 만들었나" 추적. */
export type OpsActor =
  | 'mandate' | 'sweep' | 'checker' | 'dispatcher' | 'cycle' | 'orchestrator' | 'triage' | 'manual' | 'session' | 'unknown';

export interface OpsEventInput {
  entityType: OpsEntityType;
  /** 대상 식별자 — apmId·taskId·계약명(loop)·cycleId(orchestration). */
  entityId: string;
  event: OpsEventKind;
  /** 전이 전 상태(선택) — status_change 등. */
  fromState?: string | null;
  /** 전이 후 상태(선택). */
  toState?: string | null;
  /** 왜 이 전이/이벤트가 일어났나(선택이나 강력 권장 · comprehension-debt 방지). */
  rationale?: string | null;
  actor?: OpsActor;
  /** 크로스 참조(선택) — orderId·runId·budgetScale·conflict 수 등. refs JSON 저장. */
  refs?: Record<string, unknown>;
  /** 0-10 현저성(선택·기본 이벤트별 룰). */
  importance?: number;
  /** 시각 seam(테스트). */
  now?: () => string;
}

export interface OpsEventRow {
  id: string; ts: string;
  entity_type: string; entity_id: string; event: string;
  from_state: string | null; to_state: string | null;
  rationale: string | null; actor: string | null;
  refs: string | null; importance: number | null;
}

/** 이벤트별 기본 현저성 — 집행성(cycle_end·alloc) 높고, 관찰성(created) 중간. */
const IMPORTANCE_BY_EVENT: Record<OpsEventKind, number> = {
  cycle_end: 7, alloc: 7, merge: 6, blocked: 6, status_change: 5, mission_linked: 5, cycle_start: 4, created: 4,
};

export function openOpsEventsDb(path: string = opsEventsDbPath()): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS ops_events(
    id TEXT PRIMARY KEY, ts TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, event TEXT NOT NULL,
    from_state TEXT, to_state TEXT,
    rationale TEXT, actor TEXT,
    refs TEXT, importance INT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ops_entity ON ops_events(entity_type, entity_id, ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ops_event ON ops_events(event, ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ops_ts ON ops_events(ts)`);
  return db;
}

/** 운영 이벤트 1건 기록. id 반환. fail-soft 는 호출측(recordOpsEventSafe) 또는 호출부 책임. */
export function recordOpsEvent(db: Database, input: OpsEventInput): string {
  const id = randomUUID();
  const ts = input.now ? input.now() : new Date().toISOString();
  const importance = input.importance ?? IMPORTANCE_BY_EVENT[input.event] ?? 5;
  db.run(
    `INSERT INTO ops_events (id, ts, entity_type, entity_id, event, from_state, to_state, rationale, actor, refs, importance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ts, input.entityType, input.entityId, input.event,
     input.fromState ?? null, input.toState ?? null,
     input.rationale ?? null, input.actor ?? 'unknown',
     input.refs ? JSON.stringify(input.refs) : null, importance],
  );
  return id;
}

/** fail-soft 편의 래퍼 — 자체 db open/close. 계측 지점(미션 전이·매매 사이클)이 부르는
 *  진입점. 기록 실패가 핵심 동작을 막지 않는다(null=기록 실패). */
export function recordOpsEventSafe(input: OpsEventInput): string | null {
  // 테스트 격리 — 유닛 테스트(dispatcher·blackboard 등)가 계측 지점을 밟아도 실 DB(기본
  //   경로)를 오염시키지 않는다. 명시 db 를 받는 recordOpsEvent 는 :memory: 로 테스트 가능.
  if (process.env.NODE_ENV === 'test') return null;
  let db: Database | null = null;
  try {
    db = openOpsEventsDb();
    return recordOpsEvent(db, input);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* noop */ }
  }
}

export interface OpsEventQuery {
  entityType?: OpsEntityType;
  entityId?: string;
  event?: OpsEventKind;
  sinceHours?: number;
  limit?: number;
}

/** 운영 이벤트 조회(READ-ONLY) — 최근순 타임라인. ops-status.ts 가 집계에 사용. */
export function queryOpsEvents(db: Database, opts: OpsEventQuery = {}): OpsEventRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.entityType) { where.push('entity_type = ?'); params.push(opts.entityType); }
  if (opts.entityId) { where.push('entity_id = ?'); params.push(opts.entityId); }
  if (opts.event) { where.push('event = ?'); params.push(opts.event); }
  if (opts.sinceHours) { where.push(`${within('ts')}`); params.push(`-${opts.sinceHours} hours`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(opts.limit ?? 50);
  return db.prepare(
    `SELECT id, ts, entity_type, entity_id, event, from_state, to_state, rationale, actor, refs, importance
     FROM ops_events ${clause} ORDER BY ts DESC LIMIT ?`,
  ).all(...(params as (string | number)[])) as OpsEventRow[];
}

/** 최신 1건 조회(엔티티별 현재 상태 추적용). */
export function latestOpsEvent(db: Database, entityType: OpsEntityType, entityId: string): OpsEventRow | null {
  const rows = db.prepare(
    `SELECT id, ts, entity_type, entity_id, event, from_state, to_state, rationale, actor, refs, importance
     FROM ops_events WHERE entity_type = ? AND entity_id = ? ORDER BY ts DESC LIMIT 1`,
  ).all(entityType, entityId) as OpsEventRow[];
  return rows[0] ?? null;
}
