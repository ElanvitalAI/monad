// ── M2 memory Glacier — cold 기억을 S3 보관·on-demand 느린 복원 (2026-07-08) ──
//
// M1(graded decay)이 흐려진 기억을 tier='cold'로 강등했다. M2는 그 cold 기억을 로컬
// surface_events(hot 스토어)에서 빼내 **일반 S3**(memory-archive/)에 보관한다. 삭제가
// 아니라 이관 — 사람 기억이 사라지지 않고 "떠올리기 어려워지는" 것과 같다.
//
// ★ "Glacier 은유"의 핵심은 storage class 가 아니라 계층 분리 자체다(대표 확인):
//   - 로컬 SQLite 에서 빠지면 회상 후보에서 제외(cold)
//   - 복원하려면 S3 fetch(aws s3 cp·로컬보다 느림) = "느린 복원"
//   실제 S3 Glacier/Deep-Archive storage class 로는 낮추지 않는다(일반 STANDARD).
//
// 로컬엔 메타(events_archive: id·ts·summary·domain)만 남겨 "존재는 알되 본문은 S3".
// 회상 시 searchArchive 로 후보 발견 → restoreFromArchive 로 S3 fetch → events 재삽입
// (recall_count++·tier='warm' 재활성화). S3 접근은 deps 주입 seam(테스트 mock).

import { Database } from 'bun:sqlite';
import { existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isS3Available, s3MonadKey, uploadFile, downloadFile, objectExists } from '../storage/s3.js';

/** S3 접근 seam — 기본은 실 S3(aws cli), 테스트는 in-memory mock 주입. */
export interface ArchiveS3Deps {
  available: () => boolean;
  /** 기억 1건(JSON) 보관. */
  put: (id: string, json: string) => void;
  /** 기억 1건(JSON) 복원. 없으면 null. */
  get: (id: string) => string | null;
}

/** 기본 S3 구현 — 일반 S3(memory-archive/) JSON 보관(임시파일 경유·aws cli). */
export function defaultArchiveS3Deps(): ArchiveS3Deps {
  const keyOf = (id: string) => s3MonadKey('memoryArchive', `${id}.json`);
  return {
    available: () => isS3Available(),
    put: (id, json) => {
      const tmp = join(tmpdir(), `mem-arch-${id}.json`);
      writeFileSync(tmp, json);
      try { uploadFile(tmp, keyOf(id)); } finally { if (existsSync(tmp)) rmSync(tmp, { force: true }); }
    },
    get: (id) => {
      const key = keyOf(id);
      if (!objectExists(key)) return null;
      const tmp = join(tmpdir(), `mem-rest-${id}.json`);
      try { downloadFile(key, tmp); return readFileSync(tmp, 'utf-8'); }
      catch { return null; }
      finally { if (existsSync(tmp)) rmSync(tmp, { force: true }); }
    },
  };
}

/** 아카이브 메타 인덱스 — 본문은 S3, 로컬엔 발견용 메타만. */
export function ensureArchiveTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS events_archive(
    id TEXT PRIMARY KEY, ts TEXT NOT NULL, summary TEXT, domain TEXT, kind TEXT,
    recall_count INT DEFAULT 0, archived_at TEXT NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_archive_ts ON events_archive(ts)`);
}

export interface ArchiveResult { archived: number; skipped: number }

/** ★ cold 기억을 S3 로 이관 — 삭제 아님. events 에서 빼고 events_archive 메타 + S3 본문.
 *  S3 불가 시 no-op(로컬 보존·다음 주기 재시도). deps 주입(테스트 mock). */
export function archiveColdEvents(db: Database, deps: ArchiveS3Deps = defaultArchiveS3Deps(), opts: { now?: () => string } = {}): ArchiveResult {
  ensureArchiveTable(db);
  if (!deps.available()) return { archived: 0, skipped: 0 };
  const now = opts.now?.() ?? new Date().toISOString();
  const rows = db.prepare(`SELECT * FROM events WHERE tier = 'cold'`).all() as Array<Record<string, unknown>>;
  let archived = 0, skipped = 0;
  const insMeta = db.prepare(`INSERT OR REPLACE INTO events_archive(id, ts, summary, domain, kind, recall_count, archived_at) VALUES (?,?,?,?,?,?,?)`);
  const delEvt = db.prepare(`DELETE FROM events WHERE id = ?`);
  const delFts = db.prepare(`DELETE FROM events_fts WHERE id = ?`);
  for (const r of rows) {
    const id = String(r.id);
    try {
      deps.put(id, JSON.stringify(r));           // 본문 → S3(먼저·실패 시 로컬 보존)
      db.transaction(() => {
        insMeta.run(id, String(r.ts), (r.summary ?? null) as string | null, (r.domain ?? null) as string | null, (r.kind ?? null) as string | null, Number(r.recall_count ?? 0), now);
        delFts.run(id);
        delEvt.run(id);
      })();
      archived++;
    } catch { skipped++; } // S3 업로드 실패 → 로컬 보존(이관 안 함)
  }
  return { archived, skipped };
}

export interface ArchiveHit { id: string; ts: string; summary: string | null; domain: string | null; kind: string | null }

/** 아카이브(cold) 메타 검색 — 본문 fetch 없이 후보만(느린 복원 전 발견). summary LIKE. */
export function searchArchive(db: Database, query: string, opts: { domain?: string; limit?: number } = {}): ArchiveHit[] {
  ensureArchiveTable(db);
  const limit = opts.limit ?? 8;
  const where: string[] = [];
  const params: Array<string | number> = [];
  const q = query.trim();
  if (q) { where.push(`summary LIKE ?`); params.push(`%${q}%`); }
  if (opts.domain) { where.push(`domain = ?`); params.push(opts.domain); }
  const sql = `SELECT id, ts, summary, domain, kind FROM events_archive${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as ArchiveHit[];
}

/** ★ 아카이브에서 복원(느린 복원) — S3 fetch → events 재삽입(recall_count++·tier='warm'
 *  재활성화) → 메타 제거. 복원 실패(S3 미존재·메타 없음)=null. */
export function restoreFromArchive(db: Database, id: string, deps: ArchiveS3Deps = defaultArchiveS3Deps()): Record<string, unknown> | null {
  ensureArchiveTable(db);
  const meta = db.prepare(`SELECT id FROM events_archive WHERE id = ?`).get(id) as { id: string } | undefined;
  if (!meta) return null;
  const json = deps.get(id);
  if (!json) return null;
  let ev: Record<string, unknown>;
  try { ev = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  const recall = Number(ev.recall_count ?? 0) + 1; // 복원=회상 → 미엘린 강화
  // ★ 축B B4 — reconsolidation 마커(비파괴·감사). 복원=cold 기억을 labile 상태로 재활성화하는
  //   reconsolidation 이므로 refs 에 횟수를 누적(원본 파괴 없음·append-only 정합·왜곡 추적 창).
  const refs = withReconsolidation(ev.refs);
  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO events(id, ts, surface, direction, kind, session_id, thread_id, text, summary, importance, tags, refs, category, domain, recall_count, consolidated, tier)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      String(ev.id), String(ev.ts), String(ev.surface), String(ev.direction), (ev.kind ?? null) as string | null,
      (ev.session_id ?? null) as string | null, (ev.thread_id ?? null) as string | null, String(ev.text), (ev.summary ?? null) as string | null,
      (ev.importance ?? null) as number | null, (ev.tags ?? null) as string | null, refs,
      (ev.category ?? null) as string | null, (ev.domain ?? null) as string | null, recall, Number(ev.consolidated ?? 0), 'warm',
    );
    db.prepare(`INSERT OR REPLACE INTO events_fts(id, search_text) VALUES (?, ?)`).run(String(ev.id), `${ev.summary ?? ''}\n${ev.text ?? ''}\n${ev.tags ?? ''}`);
    db.prepare(`DELETE FROM events_archive WHERE id = ?`).run(id);
  })();
  ev.recall_count = recall; ev.tier = 'warm'; ev.refs = refs;
  return ev;
}

/** refs(JSON 문자열) 에 reconsolidations 카운트를 비파괴 누적(파싱 실패 시 새로 시작). */
export function withReconsolidation(refsRaw: unknown): string {
  let obj: Record<string, unknown> = {};
  if (typeof refsRaw === 'string' && refsRaw.trim()) {
    try { const p = JSON.parse(refsRaw) as unknown; if (p && typeof p === 'object') obj = p as Record<string, unknown>; } catch { /* 비JSON refs → 새 객체 */ }
  }
  return JSON.stringify({ ...obj, reconsolidations: (Number(obj.reconsolidations) || 0) + 1 });
}
