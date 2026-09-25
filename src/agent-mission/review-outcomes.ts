// ── G9 학습루프 — 무인 리뷰 결정 결과 추적 (2026-07-23) ──────────────────────
//
// ROADMAP-monad-is-all §2b(무인레벨 삼각·학습 축). 무인 리뷰루프가 자율 머지한 PR 의 **사후 결과**를
// 기록한다: merged(머지됨)·reverted(G10 회귀감지 revert)·followup-fixed(직후 수정). 이 데이터로
// "무인 결정이 옳았나"를 측정하고, 무게(depth)별 회귀율을 집계해 G8 eligibility/무게 임계 보정 신호로 쓴다.
//
// 원칙(제1원칙·자동의 위험): 이 store 는 **관측·집계**만. 정책 자동 변경은 별도(안전 방향만 보수적·
// 위험 방향은 제안=HITL). 여기는 진실을 쌓는 곳.
// 재사용: repo-watch/pr_review_state 의 sqlite 커서 패턴(MONAD_STATE_DIR 존중·:memory: 테스트).

import { Database } from 'bun:sqlite';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReviewDepth } from './review-depth.js';

export type ReviewOutcome = 'merged' | 'reverted' | 'followup-fixed';

// ⚠️ 상태 경로 codex-mission 유지(agent-agnostic 리네임에도) — 기존 G9 학습 DB 고아화 방지. 코드만 agent-mission.
export function reviewOutcomeDbPath(): string { return join(monadStateRoot(), 'codex-mission/review_outcomes.db'); }

export function openReviewOutcomeDb(path: string = reviewOutcomeDbPath()): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS review_outcomes(
    pr TEXT PRIMARY KEY, depth TEXT, outcome TEXT, merged_at TEXT, updated_at TEXT, files TEXT
  )`);
  // 기존(files 없는) 테이블 마이그레이션 — 이미 있으면 throw(무시).
  try { db.run(`ALTER TABLE review_outcomes ADD COLUMN files TEXT`); } catch { /* 컬럼 이미 존재 */ }
  return db;
}

/** 무인 자율 머지 기록(merged). 같은 PR 재머지면 갱신. files=FU(followup) 감지용 변경 파일. */
export function recordMerge(db: Database, pr: string, depth: ReviewDepth, now: string, files: readonly string[] = []): void {
  const filesJson = JSON.stringify([...files]);
  db.run(`INSERT INTO review_outcomes(pr, depth, outcome, merged_at, updated_at, files) VALUES (?,?,?,?,?,?)
          ON CONFLICT(pr) DO UPDATE SET depth=excluded.depth, outcome='merged', merged_at=excluded.merged_at, updated_at=excluded.updated_at, files=excluded.files`,
    [pr, depth, 'merged', now, now, filesJson]);
}

/** 사후 결과 갱신(reverted·followup-fixed) — 기록된 머지에만. 없으면 no-op. */
export function updateOutcome(db: Database, pr: string, outcome: ReviewOutcome, now: string): void {
  db.run(`UPDATE review_outcomes SET outcome=?, updated_at=? WHERE pr=?`, [outcome, now, pr]);
}

export interface DepthStats {
  merged: number;
  /** 나쁜 결정(reverted + followup-fixed). */
  bad: number;
  /** 나쁜 결정 비율 (bad / total). total=0 이면 0. */
  regressionRate: number;
}
export interface ReviewStats {
  light: DepthStats;
  heavy: DepthStats;
  total: number;
}

interface OutcomeRow { depth: string; outcome: string; n: number }

/** depth×outcome 카운트 → 무게별 회귀율. 순수 집계(주입 rows 로 테스트 가능). */
export function aggregateStats(rows: readonly OutcomeRow[]): ReviewStats {
  const mk = (): DepthStats => ({ merged: 0, bad: 0, regressionRate: 0 });
  const acc: Record<'light' | 'heavy', DepthStats> = { light: mk(), heavy: mk() };
  let total = 0;
  for (const r of rows) {
    const bucket = r.depth === 'heavy' ? acc.heavy : acc.light; // 미상 depth 는 light 로(보수적으로 회귀율↑ 쪽)
    total += r.n;
    if (r.outcome === 'merged') bucket.merged += r.n;
    else bucket.bad += r.n; // reverted·followup-fixed
  }
  for (const d of [acc.light, acc.heavy]) {
    const t = d.merged + d.bad;
    d.regressionRate = t > 0 ? d.bad / t : 0;
  }
  return { light: acc.light, heavy: acc.heavy, total };
}

/** 무게별 회귀 통계 집계. */
export function queryReviewStats(db: Database): ReviewStats {
  const rows = db.prepare(`SELECT depth, outcome, COUNT(*) as n FROM review_outcomes GROUP BY depth, outcome`).all() as OutcomeRow[];
  return aggregateStats(rows);
}

// ──────────────────── FU(followup-fixed) 감지 ────────────────────

export interface MergedEntry { pr: string; files: string[]; mergedAt: string; }
export interface RecentMerge { pr: string; files: string[]; mergedAt: string; title: string; }

/**
 * FU 감지(순수) — 무인 머지(A)한 뒤, **A 가 건드린 파일을 재수정한 다른 머지 PR(B)**이 있으면 A 는
 * followup-fixed(불완전했다는 신호). B 는 A 이후 머지·revert PR 아님(그건 G10 reverted 로 이미 기록).
 * 반환=followup 으로 표시할 A 의 PR 번호 목록.
 */
export function findFollowups(merged: readonly MergedEntry[], recent: readonly RecentMerge[]): string[] {
  const out: string[] = [];
  for (const a of merged) {
    if (a.files.length === 0) continue;
    const hit = recent.some((b) =>
      b.pr !== a.pr &&
      b.mergedAt > a.mergedAt &&
      !/^revert[:\s]/i.test(b.title) &&
      b.files.some((f) => a.files.includes(f)),
    );
    if (hit) out.push(a.pr);
  }
  return out;
}

export type RunGh = (args: string[]) => string;

/** merged(아직 나쁜 결정 아닌) outcome 을 최근 머지 PR 과 대조해 followup-fixed 로 갱신. gh 주입(테스트). */
export function detectFollowups(db: Database, deps: { gh: RunGh; now: string }): string[] {
  // 1) 아직 'merged'(reverted/followup 아닌) + 파일 있는 outcome.
  const rows = db.prepare(`SELECT pr, files, merged_at FROM review_outcomes WHERE outcome='merged' AND files IS NOT NULL`).all() as Array<{ pr: string; files: string | null; merged_at: string }>;
  const merged: MergedEntry[] = rows.map((r) => ({ pr: r.pr, mergedAt: r.merged_at, files: safeParseFiles(r.files) })).filter((m) => m.files.length > 0);
  if (merged.length === 0) return [];

  // 2) 최근 머지된 PR(파일·시각·제목) — gh 배치.
  let recent: RecentMerge[] = [];
  try {
    const out = deps.gh(['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'number,files,mergedAt,title']);
    const arr = JSON.parse(out || '[]') as Array<{ number: number; files?: Array<{ path?: string }>; mergedAt?: string; title?: string }>;
    recent = arr.map((p) => ({ pr: String(p.number), mergedAt: p.mergedAt ?? '', title: p.title ?? '', files: (p.files ?? []).map((f) => f.path ?? '').filter(Boolean) }));
  } catch { return []; }

  // 3) 순수 판정 → followup 표시.
  const followups = findFollowups(merged, recent);
  for (const pr of followups) updateOutcome(db, pr, 'followup-fixed', deps.now);
  return followups;
}

function safeParseFiles(json: string | null): string[] {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; }
  catch { return []; }
}
