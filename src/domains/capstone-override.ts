// ── 캡스톤 사람 오버라이드 레이어 (2026-07-06) ─────────────────────────
//
// 자동 ABCDE 신호 위에 대표(사람)의 재량적 판단을 얹어 우선(override)한다.
// leverage_playbook 5원칙(항복신호 판단·첫 반등봉 진입 등 자동화 어려운 재량)을
// 사람이 주입하는 경로. 오버라이드가 active면 자동 국면을 누르거나 오버레이한다.
//
// 저장: SQLite `~/.monad/conatus/capstone.db` (append-only 이력 + status 갱신).
//   매매 결정 근거라 "누가 언제 왜 무엇을"의 완전 감사가 필수 → JSON 아닌 DB.
// 입력: finance_capstone_override 도구(텔레그램 자연어 → 구조화 인자).
//
// 이 모듈은 순수 상태/병합 로직 — 주문을 내지 않는다.

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CapstoneTarget } from './capstone-signals.js';
import { conatusPath } from './conatus-data-dir.js';

export type OverrideKind =
  | 'force_regime'    // 국면 강제 (BULL/BEAR/CASH) — 자동 반대여도 우선
  | 'arm_entry'       // 매수 시점 무장 (즉시 or 조건)
  | 'block_entry'     // 진입 금지 (이벤트 전 방어 — 자동 LONG을 CASH로)
  | 'hold_position'   // 현 포지션 홀드 (리밸런싱 안 함)
  | 'pause_auto';     // 자동 완전 정지 (수동 주문만)

export type OverrideScope = 'next_decision' | 'until_date' | 'until_event' | 'until_cancelled';
export type OverrideStatus = 'active' | 'consumed' | 'expired' | 'cancelled';

export interface CapstoneOverride {
  id: string;
  kind: OverrideKind;
  params: Record<string, unknown>; // { regime?, condition?, symbol?, exposure? }
  reason: string;                  // 대표 근거 (감사·설명가능성)
  scope: OverrideScope;
  expiresAt: string | null;        // ISO date (until_date) or null
  event: string | null;            // event name (until_event) or null
  priority: number;
  status: OverrideStatus;
  createdBy: string;
  createdAt: string;               // ISO timestamp
}

const DB_PATH = conatusPath('capstone.db');

function openDb(path: string = DB_PATH): Database {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS capstone_overrides (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL,
    expires_at TEXT,
    event TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL
  )`);
  return db;
}

interface Row {
  id: string; kind: string; params: string; reason: string; scope: string;
  expires_at: string | null; event: string | null; priority: number;
  status: string; created_by: string; created_at: string;
}
function rowToOverride(r: Row): CapstoneOverride {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(r.params) as Record<string, unknown>; } catch { /* keep {} */ }
  return {
    id: r.id, kind: r.kind as OverrideKind, params, reason: r.reason,
    scope: r.scope as OverrideScope, expiresAt: r.expires_at, event: r.event,
    priority: r.priority, status: r.status as OverrideStatus,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

/** 오버라이드 추가. id/createdAt은 caller가 주입(Date.now 회피·테스트 결정성). */
export function addOverride(
  o: Omit<CapstoneOverride, 'status' | 'createdBy'> & { status?: OverrideStatus; createdBy?: string },
  path: string = DB_PATH,
): CapstoneOverride {
  const db = openDb(path);
  const full: CapstoneOverride = { status: 'active', createdBy: 'owner', ...o };
  db.run(
    `INSERT INTO capstone_overrides (id,kind,params,reason,scope,expires_at,event,priority,status,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [full.id, full.kind, JSON.stringify(full.params), full.reason, full.scope,
      full.expiresAt, full.event, full.priority, full.status, full.createdBy, full.createdAt],
  );
  db.close();
  return full;
}

/** 만료 처리(until_date 지난 것 → expired) 후 active 목록(priority desc). */
export function listActiveOverrides(today: string, path: string = DB_PATH): CapstoneOverride[] {
  const db = openDb(path);
  db.run(
    `UPDATE capstone_overrides SET status='expired'
     WHERE status='active' AND scope='until_date' AND expires_at IS NOT NULL AND expires_at < ?`,
    [today],
  );
  const rows = db.query(
    `SELECT * FROM capstone_overrides WHERE status='active' ORDER BY priority DESC, created_at DESC`,
  ).all() as Row[];
  db.close();
  return rows.map(rowToOverride);
}

export function listAllOverrides(path: string = DB_PATH): CapstoneOverride[] {
  const db = openDb(path);
  const rows = db.query(`SELECT * FROM capstone_overrides ORDER BY created_at DESC`).all() as Row[];
  db.close();
  return rows.map(rowToOverride);
}

export function cancelOverride(id: string, path: string = DB_PATH): boolean {
  const db = openDb(path);
  const r = db.run(`UPDATE capstone_overrides SET status='cancelled' WHERE id=? AND status='active'`, [id]);
  db.close();
  return r.changes > 0;
}

/** next_decision scope 오버라이드를 소비 처리(1회성). resolve 후 호출. */
export function consumeOverride(id: string, path: string = DB_PATH): void {
  const db = openDb(path);
  db.run(`UPDATE capstone_overrides SET status='consumed' WHERE id=? AND status='active'`, [id]);
  db.close();
}

// ── 우선순위 병합 (핵심) ──────────────────────────────────────────────
export interface AutoRegime { target: CapstoneTarget; bear: boolean; r3: boolean; }
export interface ResolvedRegime {
  target: CapstoneTarget;
  bear: boolean;
  r3: boolean;
  source: 'auto' | 'override';
  overrideId?: string;
  overrideKind?: OverrideKind;
  paused?: boolean;   // pause_auto — 자동 정지(수동만)
  hold?: boolean;     // hold_position — 리밸런싱 안 함
  note?: string;
}

/** 자동 국면 + active 오버라이드 → 최종 국면. 사람 오버라이드가 우선.
 *  priority desc 순으로 첫 적용되는 오버라이드가 결정(효과 없는 것은 skip). */
export function resolveCapstoneRegime(auto: AutoRegime, overrides: CapstoneOverride[]): ResolvedRegime {
  for (const ov of overrides) {
    const base = { source: 'override' as const, overrideId: ov.id, overrideKind: ov.kind };
    switch (ov.kind) {
      case 'pause_auto':
        return { ...auto, ...base, paused: true, note: `자동 정지(수동만) — ${ov.reason}` };
      case 'force_regime': {
        const regime = String(ov.params.regime ?? '').toUpperCase();
        if (regime === 'BULL')
          return { target: 'LONG_100', bear: false, r3: false, ...base, note: `강세 강제(1.5×) — ${ov.reason}` };
        // BEAR/CASH/그 외 방어
        return { target: 'CASH_100', bear: true, r3: false, ...base, note: `방어 강제 — ${ov.reason}` };
      }
      case 'hold_position':
        return { ...auto, ...base, hold: true, note: `현 포지션 홀드 — ${ov.reason}` };
      case 'arm_entry':
        return { target: 'LONG_100', bear: false, r3: false, ...base, note: `매수 무장 — ${ov.reason}` };
      case 'block_entry':
        if (auto.target === 'LONG_100')
          return { target: 'CASH_100', bear: true, r3: false, ...base, note: `진입 금지 — ${ov.reason}` };
        break; // 자동이 진입 아니면 효과 없음 → 다음 오버라이드
    }
  }
  return { ...auto, source: 'auto' };
}
