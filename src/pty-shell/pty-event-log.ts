// ── 크로스-프로세스 PTY 이벤트 로그 + wait 프리미티브 (PLAN §11 F3 · 프론티어 차용 #5) ──
//
// pty-manifest 는 "지금 상태"의 스냅샷(관측 수렴·라우팅 아님)이다. 코디네이션(부모가 자식 상태를
// 기다림·자식↔자식)에는 **시계열 이벤트 + 단조 커서**가 필요하다 — herdr 의 EventHub `events_after(seq)`
// (`src/api/wait.rs`)와 orca 의 `MessageRow.sequence`(`orchestration/types.ts`)가 둘 다 이 형태다.
// [[RESEARCH-pty-multiplexer-frontier-herdr-orca-2026-07-24]] §5 #5.
//
// ⚠️ ChannelBus 는 프로세스-로컬이라 크로스-프로세스 wait 불가 → pty-manifest 와 동형으로 **공유 SQLite**
// (`MONAD_STATE_DIR` 스코프). AUTOINCREMENT seq = 전역 단조 커서(herdr `current_sequence()`).
//
// 이 모듈 = 라우팅 플레인의 *토대*(이벤트 append + seq 후 read + 상태전이 dedup + wait). 실제 상태
// *분류*(frame→idle/working/blocked)는 #1(region-rule 감지·후속)이 이 로그에 append 한다. 즉 #5=전송로,
// #1=생산자. 입력 주입(부모→자식 write)은 P2 arbiter 선결이라 여기 없음(관측·대기만).
//
// ⚠️ fail-soft 전부(로그 실패가 PTY/코디네이션을 깨지 않음). cf. `pty-manifest.ts`(동형 db-open).

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { monadStateRoot } from '../autopilot/state-paths';

/** 이벤트 로그 db 경로 — `MONAD_STATE_DIR` 존중(격리·resolver 경유), 기본 `~/.monad/pty/events.db`. manifest.db 동형. */
export function ptyEventLogDbPath(): string {
  return join(monadStateRoot(), 'pty', 'events.db');
}

/** 상태 어휘 — herdr/orca 합집합(orca `AgentStatusState` + herdr idle/unknown). */
export type SurfaceState = 'idle' | 'working' | 'blocked' | 'waiting' | 'done' | 'unknown';

export interface PtyEventRow {
  readonly seq: number;
  readonly tsMs: number;
  readonly instance: string;
  readonly surfaceId: string;
  /** 'state'(상태전이) | 'message'(자식↔자식 메일·후속 F4) | 확장. */
  readonly kind: string;
  readonly state: SurfaceState | null;
  /** 감지된 에이전트 이름(monad|codex|…) — identity 핀닝용(#1 감지가 채움). */
  readonly agent: string | null;
  /** JSON payload(상태 증거·메시지 본문). */
  readonly payload: string | null;
}

let _db: Database | null = null;
let _dbFailed = false;

/** Close the cached events db so a later same-process file can open MONAD_STATE_DIR afresh.
 *  Same seam as setPtyManifestDbPathForTesting — env restore alone leaves this handle on a deleted path. */
export function resetPtyEventLogForTesting(): void {
  _db?.close();
  _db = null;
  _dbFailed = false;
}

function db(): Database | null {
  if (_db) return _db;
  if (_dbFailed) return null;
  try {
    const path = ptyEventLogDbPath();
    try { mkdirSync(dirname(path), { recursive: true }); } catch { /* noop */ }
    const d = new Database(path);
    d.run('PRAGMA journal_mode = WAL');    // 멀티프로세스 동시 append
    d.run('PRAGMA busy_timeout = 2000');
    d.run(`CREATE TABLE IF NOT EXISTS pty_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts_ms INTEGER NOT NULL,
      instance TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT,
      agent TEXT,
      payload TEXT
    )`);
    d.run('CREATE INDEX IF NOT EXISTS idx_pty_events_surface ON pty_events(surface_id, seq)');
    _db = d;
    return d;
  } catch {
    _dbFailed = true;   // 한 번 실패 후 no-op(재시도 폭주 방지)
    return null;
  }
}

function rowFrom(r: Record<string, unknown>): PtyEventRow {
  return {
    seq: Number(r.seq), tsMs: Number(r.ts_ms), instance: String(r.instance),
    surfaceId: String(r.surface_id), kind: String(r.kind),
    state: (r.state == null ? null : (String(r.state) as SurfaceState)),
    agent: (r.agent == null ? null : String(r.agent)),
    payload: (r.payload == null ? null : String(r.payload)),
  };
}

export interface AppendPtyEventInput {
  readonly instance: string;
  readonly surfaceId: string;
  readonly kind: string;
  readonly state?: SurfaceState;
  readonly agent?: string;
  readonly payload?: unknown; // JSON.stringify'd
  readonly now: number;
}

/** 이벤트 append(fail-soft). 새 seq 반환(실패 시 0). */
export function appendPtyEvent(input: AppendPtyEventInput): number {
  try {
    const d = db(); if (!d) return 0;
    const payload = input.payload === undefined ? null : safeStringify(input.payload);
    const row = d.query(
      `INSERT INTO pty_events (ts_ms, instance, surface_id, kind, state, agent, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
    ).get(input.now, input.instance, input.surfaceId, input.kind, input.state ?? null, input.agent ?? null, payload) as { seq: number } | null;
    return row ? Number(row.seq) : 0;
  } catch { return 0; }
}

function safeStringify(v: unknown): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}

export interface ReadEventsOpts {
  readonly surfaceId?: string;
  readonly instance?: string;
  readonly kind?: string;
  readonly limit?: number;
}

/** seq 이후 이벤트(오름차순) — herdr `events_after(seq)`. fail-soft(빈 배열). */
export function readPtyEventsAfter(afterSeq: number, opts: ReadEventsOpts = {}): PtyEventRow[] {
  try {
    const d = db(); if (!d) return [];
    return readPtyEventsAfterFromDatabase(d, afterSeq, opts);
  } catch { return []; }
}

export type PtyEventLogReadResult =
  | { readonly status: 'ok'; readonly rows: readonly PtyEventRow[] }
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable' };

function readPtyEventsAfterFromDatabase(d: Database, afterSeq: number, opts: ReadEventsOpts): PtyEventRow[] {
  const where: string[] = ['seq > ?'];
  const params: SQLQueryBindings[] = [afterSeq];
  if (opts.surfaceId !== undefined) { where.push('surface_id = ?'); params.push(opts.surfaceId); }
  if (opts.instance !== undefined) { where.push('instance = ?'); params.push(opts.instance); }
  if (opts.kind !== undefined) { where.push('kind = ?'); params.push(opts.kind); }
  const limit = opts.limit && opts.limit > 0 ? ` LIMIT ${Math.floor(opts.limit)}` : '';
  const rows = d.query(`SELECT * FROM pty_events WHERE ${where.join(' AND ')} ORDER BY seq ASC${limit}`).all(...params) as Record<string, unknown>[];
  return rows.map(rowFrom);
}

/** Read a selected ledger path without creating it. Missing and unreadable roots remain distinguishable. */
export function readPtyEventsAfterAt(dbPath: string, afterSeq: number, opts: ReadEventsOpts = {}): PtyEventLogReadResult {
  if (!existsSync(dbPath)) return { status: 'missing' };
  let d: Database | null = null;
  try {
    d = new Database(dbPath, { readonly: true });
    d.run('PRAGMA busy_timeout = 2000');
    return { status: 'ok', rows: readPtyEventsAfterFromDatabase(d, afterSeq, opts) };
  } catch {
    return { status: 'unreadable' };
  } finally {
    d?.close();
  }
}

/** 이벤트 보존 TTL 기본 — 장기 실행 데몬서 events.db 무제한 증가 방지(review should-fix).
 *  데몬 스위퍼가 주기적으로 `purgePtyEventsBefore(now)` 호출(cf. pty-manifest purge). */
export const PTY_EVENT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** ttlMs 보다 오래된 이벤트 삭제(fail-soft). 삭제 행수 반환. seq 는 단조 유지(삭제해도 재사용 안 함). */
export function purgePtyEventsBefore(nowMs: number, ttlMs: number = PTY_EVENT_TTL_MS): number {
  try {
    const d = db(); if (!d) return 0;
    const r = d.run('DELETE FROM pty_events WHERE ts_ms < ?', [nowMs - ttlMs]);
    return r.changes ?? 0;
  } catch { return 0; }
}

/** 현재 최대 seq — wait 전 스냅(herdr `current_sequence()`). fail-soft(0). */
export function currentPtyEventSeq(): number {
  try {
    const d = db(); if (!d) return 0;
    const r = d.query('SELECT MAX(seq) AS s FROM pty_events').get() as { s: number | null } | null;
    return r && r.s != null ? Number(r.s) : 0;
  } catch { return 0; }
}

/** 한 surface 의 마지막 상태 이벤트(전이 dedup·현재상태 조회). null=이력 없음. */
export function latestSurfaceState(surfaceId: string): { state: SurfaceState; agent: string | null; seq: number } | null {
  try {
    const d = db(); if (!d) return null;
    const r = d.query(`SELECT state, agent, seq FROM pty_events WHERE surface_id = ? AND kind = 'state' ORDER BY seq DESC LIMIT 1`).get(surfaceId) as Record<string, unknown> | null;
    if (!r || r.state == null) return null;
    return { state: String(r.state) as SurfaceState, agent: r.agent == null ? null : String(r.agent), seq: Number(r.seq) };
  } catch { return null; }
}

/** ⭐상태 전이 기록 — **변화가 있을 때만** append(로그=전이·매틱 아님·herdr state_change_seq). 새 seq
 *  반환, 미변화면 null. agent 만 바뀌어도 전이로 본다(재사용 surface 식별).
 *  ⚠️ latest-read→append 는 원자적이지 않다(멀티프로세스서 동일 전이 중복 append 가능). append-only
 *  로그라 중복 전이는 무해(wait 는 첫 매치서 멱등·readAfter 는 둘 다 반환하나 진단 consumer 가 dedup).
 *  단일 프로세스 폴러(데몬 1개)가 정상 경로라 실질 경합 없음. 강한 보장이 필요해지면 unique 제약/트랜잭션. */
export function recordSurfaceStateTransition(input: {
  instance: string; surfaceId: string; state: SurfaceState; agent?: string; evidence?: unknown; now: number;
}): number | null {
  const prev = latestSurfaceState(input.surfaceId);
  const agent = input.agent ?? null;
  if (prev && prev.state === input.state && prev.agent === agent) return null; // 미변화
  const appendInput: AppendPtyEventInput = {
    instance: input.instance, surfaceId: input.surfaceId, kind: 'state', state: input.state, now: input.now,
  };
  if (input.agent !== undefined) (appendInput as { agent?: string }).agent = input.agent;
  if (input.evidence !== undefined) (appendInput as { payload?: unknown }).payload = input.evidence;
  const seq = appendPtyEvent(appendInput);
  return seq > 0 ? seq : null;
}

// ── wait 프리미티브 (herdr wait_for_agent — identity 핀닝·stall 가드) ──

export interface SurfaceStateWaitSpec {
  readonly surfaceId: string;
  /** identity 핀 — 재시작 자식이 wait 오만족 못 하게(herdr agent_wait_identity_matches). */
  readonly instance?: string;
  readonly agent?: string;
  /** 이 상태집합에 들면 매치(기본 idle|done|blocked). */
  readonly until?: readonly SurfaceState[];
  /** 이 seq **이후** 이벤트만(=현 stale 상태 아닌 "다음 전이" 대기·herdr state_change_seq). */
  readonly afterSeq: number;
  readonly timeoutMs: number;
  readonly pollMs?: number;
  /** anti-hang: 이 시간 내 어떤 상태 이벤트도 없으면 stalled(herdr agent_prompt_stalled 5s). */
  readonly stallMs?: number;
}

export type SurfaceStateWaitResult =
  | { readonly outcome: 'matched'; readonly state: SurfaceState; readonly seq: number }
  | { readonly outcome: 'timeout' }
  | { readonly outcome: 'stalled' };

const DEFAULT_UNTIL: readonly SurfaceState[] = ['idle', 'done', 'blocked'];

/** 이 이벤트가 이 wait 의 **대상(identity)**인가 — surface + instance/agent 핀(until 무관).
 *  herdr agent_wait_identity_matches. stall 리셋·매치 둘 다 이 identity 를 써야 타 점유자
 *  이벤트가 stall 판정을 방해하지 못한다(review must-fix). */
export function eventIsForWait(ev: PtyEventRow, spec: SurfaceStateWaitSpec): boolean {
  if (ev.kind !== 'state' || ev.state == null) return false;
  if (ev.surfaceId !== spec.surfaceId) return false;
  if (spec.instance !== undefined && ev.instance !== spec.instance) return false;
  // agent 핀: 지정 시 이벤트 agent 가 정확히 일치해야(unknown/타 agent 는 오만족 거부).
  if (spec.agent !== undefined && ev.agent !== spec.agent) return false;
  return true;
}

/** ⭐순수 매처 — identity 대상 + 목표 상태집합(until). herdr agent_wait_matches. */
export function eventMatchesWait(ev: PtyEventRow, spec: SurfaceStateWaitSpec): boolean {
  if (!eventIsForWait(ev, spec)) return false;
  const until = spec.until ?? DEFAULT_UNTIL;
  return until.includes(ev.state as SurfaceState);
}

export interface WaitDeps {
  readonly readAfter?: (afterSeq: number, opts: ReadEventsOpts) => PtyEventRow[];
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** ⭐부모가 자식(surface) 상태를 기다림 — 크로스-프로세스(공유 db 폴). 이벤트구동 의미: `afterSeq` 이후
 *  전이만 보고, identity 핀으로 재시작 자식 오만족 차단, `stallMs` 로 무반응 안티행. deps 주입=유닛테스트. */
export async function waitForSurfaceState(spec: SurfaceStateWaitSpec, deps: WaitDeps = {}): Promise<SurfaceStateWaitResult> {
  const readAfter = deps.readAfter ?? readPtyEventsAfter;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = spec.pollMs ?? 200;
  const start = now();
  let cursor = spec.afterSeq;
  let lastActivityAt = start; // stall 기준 — 어떤 상태 이벤트든 리셋
  // 폴 루프: readAfter → 매치 검사 → stall/timeout → sleep.
  for (;;) {
    const events = readAfter(cursor, { surfaceId: spec.surfaceId });
    for (const ev of events) {
      if (ev.seq > cursor) cursor = ev.seq;
      // stall 리셋은 **이 wait 의 identity 대상** 이벤트에만(타 점유자 활동이 stall 을 무기한
      // 방해하지 못하게 — review must-fix). identity 불일치 이벤트는 cursor 만 전진.
      if (eventIsForWait(ev, spec)) {
        lastActivityAt = now();
        // 매치는 eventMatchesWait 재사용(identity + until 단일 정의·중복 제거 — review).
        if (eventMatchesWait(ev, spec)) return { outcome: 'matched', state: ev.state as SurfaceState, seq: ev.seq };
      }
    }
    const t = now();
    if (spec.stallMs !== undefined && t - lastActivityAt >= spec.stallMs) return { outcome: 'stalled' };
    if (t - start >= spec.timeoutMs) return { outcome: 'timeout' };
    await sleep(pollMs);
  }
}
