// ── 미션 관계 그래프 엣지 저장 (E2 · 미션 생태계 RFC §4.1 · 2026-07-18) ─────────────
//
// 미션은 고립 단위가 아니라 서로 연관된 생태계다(대표 2026-07-18). 미션 간 관계를 4종 엣지로
// 1급화해 별도 DB(mission_edges.db)에 기록한다 — 계보(파생)·이어가기(A완료→B)·공진화(A 학습→B
// 개선)·연관(같은 코드영역). 구현 이관 장치(변경 스토리·발견→아크)가 이 엣지를 생성하고, 그래프
// 히스토리가 미션 간 공진화·자기제안(D1~D4)의 근거가 된다.
//
// 안전: 읽기/쓰기 전용 메타(집행 0·armed 아님). fail-soft — 엣지 기록/조회 실패가 미션을 막지 않는다.
// 계보는 registry(childMissionIds/parentMissionId)에도 남지만, 여기 그래프로 흡수해 4종을 통합 조회한다.

import { Database } from 'bun:sqlite';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';

/** 미션 관계 4종(RFC §4.1). lineage=계보(파생)·continuation=이어가기(A완료→B)·
 *  coevolution=공진화(A 학습→B 개선)·association=연관(같은 코드영역·무방향 의미). */
export type MissionEdgeKind = 'lineage' | 'continuation' | 'coevolution' | 'association';
export const MISSION_EDGE_KINDS: readonly MissionEdgeKind[] = ['lineage', 'continuation', 'coevolution', 'association'];

/** 엣지 1건 — from→to·종류·근거·생성시각. (from,to,kind) 가 고유(dedup). */
export interface MissionEdge {
  fromId: string;
  toId: string;
  kind: MissionEdgeKind;
  evidence: string;
  createdAt: number;
}

/** mission_edges DB 경로(autopilot/·격리 데몬 MONAD_STATE_DIR 존중). */
export function missionEdgesDbPath(): string {
  return join(monadStateRoot(), 'autopilot/mission_edges.db');
}

let _db: Database | null = null;
/** DB open(스키마 보장). dbPath 지정 시 캐시 안 함(테스트 격리·':memory:' 지원).
 *  ★ NODE_ENV=test 에서 인자 없이 호출 시 :memory: — attachChildMission 등 경유 호출이 실 DB 를
 *  오염시키지 않게(registry 테스트가 격리 없이 attach 하므로). 명시 dbPath 는 항상 존중. */
export function openMissionEdgesDb(dbPath?: string): Database {
  if (!dbPath && _db) return _db;
  const p = dbPath ?? (process.env.NODE_ENV === 'test' ? ':memory:' : missionEdgesDbPath());
  if (p !== ':memory:') mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p);
  db.run('PRAGMA journal_mode = WAL;');
  db.run(`CREATE TABLE IF NOT EXISTS mission_edges (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id, kind)
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_mission_edges_from ON mission_edges(from_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_mission_edges_to ON mission_edges(to_id)');
  if (!dbPath && p !== ':memory:') _db = db;
  return db;
}

function isKind(k: string): k is MissionEdgeKind {
  return (MISSION_EDGE_KINDS as readonly string[]).includes(k);
}

/** 엣지 추가(upsert·(from,to,kind) dedup). evidence 는 최신으로 갱신·createdAt 은 최초 보존.
 *  self-loop(from===to)·빈 id·미상 kind 는 무시. fail-soft(기록 실패가 미션 무차단). */
export function addMissionEdge(
  fromId: string, toId: string, kind: MissionEdgeKind, evidence = '',
  deps: { db?: Database; now?: number } = {},
): void {
  if (!fromId || !toId || fromId === toId || !isKind(kind)) return;
  try {
    const db = deps.db ?? openMissionEdgesDb();
    db.run(
      `INSERT INTO mission_edges (from_id, to_id, kind, evidence, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_id, to_id, kind) DO UPDATE SET evidence = excluded.evidence`,
      [fromId.slice(0, 120), toId.slice(0, 120), kind, String(evidence).slice(0, 500), deps.now ?? Date.now()],
    );
  } catch { /* fail-soft */ }
}

/** 엣지 조회. missionId 주면 그 미션 관련(out=from·in=to·both=양방향)·kind 필터. 최신순. fail-soft([]). */
export function listMissionEdges(
  opts: { missionId?: string; kind?: MissionEdgeKind; direction?: 'out' | 'in' | 'both' } = {},
  deps: { db?: Database } = {},
): MissionEdge[] {
  try {
    const db = deps.db ?? openMissionEdgesDb();
    const where: string[] = [];
    const args: (string)[] = [];
    if (opts.missionId) {
      const dir = opts.direction ?? 'both';
      if (dir === 'out') { where.push('from_id = ?'); args.push(opts.missionId); }
      else if (dir === 'in') { where.push('to_id = ?'); args.push(opts.missionId); }
      else { where.push('(from_id = ? OR to_id = ?)'); args.push(opts.missionId, opts.missionId); }
    }
    if (opts.kind) { where.push('kind = ?'); args.push(opts.kind); }
    const sql = `SELECT from_id, to_id, kind, evidence, created_at FROM mission_edges${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
    const rows = db.query(sql).all(...args) as Array<{ from_id: string; to_id: string; kind: string; evidence: string; created_at: number }>;
    return rows.map((r) => ({ fromId: r.from_id, toId: r.to_id, kind: r.kind as MissionEdgeKind, evidence: r.evidence, createdAt: r.created_at }));
  } catch { return []; }
}
