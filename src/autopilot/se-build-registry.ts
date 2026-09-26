// ── SE 격리 빌드 레지스트리 (대표 2026-07-13·PLAN B0) ─────────────────────────
//
// SE 격리 빌드(미션 페이즈가 별도 worktree 에서 terra/opus 로 자율 구현하는 1회 실행)를
// ID 로 추적한다. 빌드 = 페이즈 SE 시도 1회(재시도/폴백/재구현마다 새 buildId). 이 레지스트리가
// "어떤 빌드가 살아있나 · 그 안에서 뭘 하나(로그 경로) · worktree 는 어디"를 단일 진실로 갖고,
// tool(se_build)·CLI(elanous ops build)·SSE(/v1/builds)가 이걸 읽는다. ops-log 와 동형·fail-soft.
// PLAN: 내부 문서 `PLAN-se-build-observability-stream-2026-07-13`

import { Database } from 'bun:sqlite';
import { elanousStateRoot } from './state-paths.js';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** [ISO-3] ELANOUS_STATE_DIR 존중(lazy). */
export function seBuildsDbPath(): string { return join(elanousStateRoot(), 'conatus/se_builds.db'); }
export function seBuildsLogDir(): string { return join(elanousStateRoot(), 'conatus/builds'); }

// ★ no-change(대표 2026-07-14) — opus 등이 "변경 0(no-op)"을 낸 시도. 종전엔 mapBuildStatus 가
//   built 로 뭉개 트레일에 "opus→built"(성공처럼) 오표시됐다(실제는 아무것도 안 함). 별도 상태로 정직화.
export type SeBuildStatus = 'running' | 'built' | 'no-change' | 'gate-failed' | 'failed' | 'aborted';

export interface SeBuildRecord {
  buildId: string;
  missionId: string;
  phaseId: string;
  phaseTitle: string;
  index: number;
  total: number;
  attemptSeq: number;
  backend: string;
  worktree: string | null;
  branch: string | null;
  status: SeBuildStatus;
  maxTurns: number | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  logPath: string;
  prUrl: string | null;
  gateResult: string | null;
}

/** Build ID = bld_<phaseHex8>_<attemptSeq>. phaseId 'task:xxxx' → hex8. 결정론·순수. */
export function makeBuildId(phaseId: string, attemptSeq: number): string {
  const hex = (phaseId.replace(/^task:/, '').replace(/[^a-f0-9]/gi, '').slice(0, 8)) || 'unknown';
  return `bld_${hex}_${attemptSeq}`;
}

/** per-build 스트림 로그 경로 — SE 브릿지가 tee, tail -f / SSE 가 follow. */
export function buildLogPath(buildId: string): string {
  const safe = buildId.replace(/[^\w.-]/g, '_');
  return join(seBuildsLogDir(), `${safe}.log`);
}

export function openSeBuildsDb(path: string = seBuildsDbPath()): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS se_builds(
    build_id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL, phase_id TEXT NOT NULL, phase_title TEXT NOT NULL,
    idx INT NOT NULL, total INT NOT NULL, attempt_seq INT NOT NULL,
    backend TEXT NOT NULL, worktree TEXT, branch TEXT,
    status TEXT NOT NULL, max_turns INT,
    started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT,
    log_path TEXT NOT NULL, pr_url TEXT, gate_result TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_se_builds_mission ON se_builds(mission_id, started_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_se_builds_phase ON se_builds(phase_id, attempt_seq)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_se_builds_status ON se_builds(status, updated_at)`);
  return db;
}

export interface UpsertBuildInput {
  buildId: string; missionId: string; phaseId: string; phaseTitle: string;
  index: number; total: number; attemptSeq: number; backend: string;
  worktree?: string | null; branch?: string | null;
  status: SeBuildStatus; maxTurns?: number | null;
  prUrl?: string | null; gateResult?: string | null;
  /** 시각 seam(테스트). */
  now?: () => string;
}

/** 빌드 레코드 upsert — 시작(running) 시 삽입, 종결(built/failed) 시 상태/endedAt 갱신.
 *  기존 startedAt/logPath 는 보존(재-upsert 가 시작시각을 덮지 않게). */
export function upsertBuild(db: Database, input: UpsertBuildInput): void {
  const now = input.now ?? (() => new Date().toISOString());
  const ts = now();
  const existing = getBuild(db, input.buildId);
  const startedAt = existing?.startedAt ?? ts;
  const terminal = input.status !== 'running';
  const logPath = existing?.logPath ?? buildLogPath(input.buildId);
  db.prepare(
    `INSERT OR REPLACE INTO se_builds
     (build_id, mission_id, phase_id, phase_title, idx, total, attempt_seq, backend,
      worktree, branch, status, max_turns, started_at, updated_at, ended_at, log_path, pr_url, gate_result)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.buildId, input.missionId, input.phaseId, input.phaseTitle,
    input.index, input.total, input.attemptSeq, input.backend,
    input.worktree ?? existing?.worktree ?? null, input.branch ?? existing?.branch ?? null,
    input.status, input.maxTurns ?? existing?.maxTurns ?? null,
    startedAt, ts, terminal ? ts : (existing?.endedAt ?? null),
    logPath, input.prUrl ?? existing?.prUrl ?? null, input.gateResult ?? existing?.gateResult ?? null,
  );
}

/** fail-soft 래퍼(자체 open/close). 테스트 격리(NODE_ENV=test)면 실 DB 미기록. */
export function upsertBuildSafe(input: UpsertBuildInput): void {
  if (process.env.NODE_ENV === 'test') return;
  let db: Database | null = null;
  try { db = openSeBuildsDb(); upsertBuild(db, input); }
  catch { /* fail-soft */ }
  finally { try { db?.close(); } catch { /* noop */ } }
}

function rowToRecord(r: Record<string, unknown>): SeBuildRecord {
  return {
    buildId: r.build_id as string, missionId: r.mission_id as string,
    phaseId: r.phase_id as string, phaseTitle: r.phase_title as string,
    index: r.idx as number, total: r.total as number, attemptSeq: r.attempt_seq as number,
    backend: r.backend as string, worktree: (r.worktree as string) ?? null, branch: (r.branch as string) ?? null,
    status: r.status as SeBuildStatus, maxTurns: (r.max_turns as number) ?? null,
    startedAt: r.started_at as string, updatedAt: r.updated_at as string, endedAt: (r.ended_at as string) ?? null,
    logPath: r.log_path as string, prUrl: (r.pr_url as string) ?? null, gateResult: (r.gate_result as string) ?? null,
  };
}

export function getBuild(db: Database, buildId: string): SeBuildRecord | null {
  const r = db.prepare(`SELECT * FROM se_builds WHERE build_id = ?`).get(buildId) as Record<string, unknown> | undefined;
  return r ? rowToRecord(r) : null;
}

/** 빌드 목록 — 기본 활성(running) 우선, opts 로 missionId/전체 필터. 최신순. */
export function listBuilds(db: Database, opts: { missionId?: string; all?: boolean; limit?: number } = {}): SeBuildRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.missionId) { where.push('mission_id = ?'); params.push(opts.missionId); }
  if (!opts.all) { where.push(`status = 'running'`); }
  const sql = `SELECT * FROM se_builds ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`;
  params.push(opts.limit ?? 50);
  return (db.prepare(sql).all(...params as never[]) as Record<string, unknown>[]).map(rowToRecord);
}

/** 그 페이즈의 최근 빌드 1건(모든 상태·최신 attempt). running 이면 "빌드 중" 표시용(PWA·2026-07-14). */
export function latestBuildForPhase(phaseId: string, dbPath?: string): SeBuildRecord | null {
  let db: Database | null = null;
  try {
    db = openSeBuildsDb(dbPath ?? seBuildsDbPath());
    const r = db.prepare(
      `SELECT * FROM se_builds WHERE phase_id = ? ORDER BY attempt_seq DESC, updated_at DESC LIMIT 1`,
    ).get(phaseId) as Record<string, unknown> | undefined;
    return r ? rowToRecord(r) : null;
  } catch { return null; }
  finally { try { db?.close(); } catch { /* noop */ } }
}

/** 그 페이즈의 다음 시도 순번(기존 빌드 수 +1). 재시도/폴백/재구현마다 새 buildId 부여용. */
export function nextAttemptSeq(db: Database, phaseId: string): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM se_builds WHERE phase_id = ?`).get(phaseId) as { n: number } | undefined;
  return (r?.n ?? 0) + 1;
}

/** 빌드 상태만 갱신(중단 등·빌드 컨트롤). terminal 이면 endedAt 세팅. 미존재면 false. */
export function markBuildStatus(db: Database, buildId: string, status: SeBuildStatus, now: () => string = () => new Date().toISOString()): boolean {
  const ts = now();
  const terminal = status !== 'running';
  const r = db.prepare(
    `UPDATE se_builds SET status = ?, updated_at = ?, ended_at = CASE WHEN ? THEN ? ELSE ended_at END WHERE build_id = ?`,
  ).run(status, ts, terminal ? 1 : 0, ts, buildId);
  return r.changes > 0;
}

// ── 진단 접합 (P6 · 2026-07-13) — 빌드 레코드 = attempts 트레일의 사실원 ─────────
// PhaseOutcome.attempts 가 summary 문자열 regex 재구성(best-effort)이던 갭을 실기록으로 대체.
// run-mission 영속 + 텔레그램 카드가 같은 함수를 소비(진단 소비 일원화).

/** SeBuildStatus → PhaseAttempt.gateResult 매핑(진행중 빌드는 트레일에서 제외). */
const ATTEMPT_GATE: Record<Exclude<SeBuildStatus, 'running'>, 'pass' | 'built' | 'no-change' | 'gate-failed' | 'error'> = {
  built: 'built', 'no-change': 'no-change', 'gate-failed': 'gate-failed', failed: 'error', aborted: 'error',
};

export interface PhaseAttemptFact {
  backend: string;
  maxTurns?: number;
  gateResult: 'pass' | 'built' | 'no-change' | 'gate-failed' | 'error';
  gateOutputExcerpt?: string;
}

/** 그 페이즈의 실측 시도 트레일 — attemptSeq 순. 기록 없으면 [](호출측이 폴백 판단).
 *  fail-soft·READ-ONLY. 테스트는 dbPath 로 격리. */
export function attemptsForPhase(phaseId: string, dbPath?: string): PhaseAttemptFact[] {
  let db: Database | null = null;
  try {
    db = openSeBuildsDb(dbPath ?? seBuildsDbPath());
    const rows = (db.prepare(
      `SELECT * FROM se_builds WHERE phase_id = ? AND status != 'running' ORDER BY attempt_seq ASC LIMIT 20`,
    ).all(phaseId) as Record<string, unknown>[]).map(rowToRecord);
    return rows.map((b): PhaseAttemptFact => ({
      backend: b.backend,
      ...(b.maxTurns ? { maxTurns: b.maxTurns } : {}),
      gateResult: ATTEMPT_GATE[b.status as Exclude<SeBuildStatus, 'running'>] ?? 'error',
      ...(b.gateResult ? { gateOutputExcerpt: b.gateResult.slice(0, 200) } : {}),
    }));
  } catch { return []; }
  finally { try { db?.close(); } catch { /* noop */ } }
}
