// ── community_buzz.db — 커뮤니티 버즈 스토어 + velocity (P1 · 2026-07-09) ──────
//
// PLAN-community-buzz-surveillance-2026-07-09 §6. 포럼 글을 회차별로 적재하고
// 조회/추천 델타(velocity)를 계산한다. breaking-signals.db 스키마 패턴 계승.
//   buzz_posts        — 글 1건(upsert·최신 상태)
//   buzz_snapshots    — 회차별 조회/추천 시계열(velocity 계산용)
//   buzz_fts          — 제목 전문검색(역방향 검색·fact_check 합류용)
// 긍부정/티커/정규화는 P1.5~P2 에서 얹는다(스키마에 컬럼만 예약).

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { FmkoreaPost } from './parse-fmkorea.js';
import { freshnessScore } from './parse-fmkorea.js';
import { marketSessions } from '../finance.js';
import { conatusPath } from '../conatus-data-dir.js';
import { olderThan } from '../../time/db-window.js';

export const BUZZ_DB_PATH = conatusPath('community_buzz.db');

/** 세션 인지 freshness 반감기 — 장중(빠른 노후화 20분)·야간/주말(느리게 120분).
 *  대표 지시: freshness 는 세션인지 반감기. 빠른 장에선 30분 전 얘기가 이미 stale. */
export function sessionHalflifeMin(nowMs: number): number {
  const s = marketSessions(new Date(nowMs));
  return (s.krLive || s.usLive || s.usOvernight) ? 20 : 120;
}

export function openBuzzDb(path: string = BUZZ_DB_PATH): Database {
  if (path !== ':memory:' && !existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run('PRAGMA busy_timeout = 2000');
  db.run(`CREATE TABLE IF NOT EXISTS buzz_posts(
    id TEXT PRIMARY KEY,        -- 'fmkorea:<postid>'
    ts TEXT NOT NULL,           -- 최초 관측
    fetch_ts TEXT NOT NULL,     -- 최근 관측
    forum TEXT NOT NULL,        -- fmkorea|reddit
    lane TEXT,                  -- firehose|popular|reddit-hot
    category TEXT,              -- 국내주식|해외주식|잡담|...
    author TEXT, title TEXT NOT NULL, url TEXT,
    posted_at TEXT,             -- ★ 작성 시각 ISO(freshness 척도 근거·대표 지시)
    views INTEGER, recommends INTEGER, comments INTEGER,
    velocity INTEGER DEFAULT 0, -- 최근 폴 대비 engagement 델타(조회 or 추천)
    tickers TEXT, sentiment REAL, spam INTEGER, importance INTEGER, reason TEXT, -- P1.5~P2 예약
    digested INTEGER DEFAULT 0, alerted INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS buzz_snapshots(
    post_id TEXT NOT NULL, ts TEXT NOT NULL, views INTEGER, recommends INTEGER, comments INTEGER
  )`);
  // 멱등 마이그레이션 — 기존 DB(구스키마)에 신규 컬럼 추가(이미 있으면 무시).
  for (const [table, col, type] of [
    ['buzz_posts', 'posted_at', 'TEXT'], ['buzz_posts', 'comments', 'INTEGER'],
    ['buzz_posts', 'accel', 'INTEGER'], // ② 가속(Δvelocity)
    ['buzz_snapshots', 'comments', 'INTEGER'],
  ] as const) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* 이미 존재 */ }
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_buzz_snap ON buzz_snapshots(post_id, ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_buzz_fetch ON buzz_posts(forum, fetch_ts)`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS buzz_fts USING fts5(id UNINDEXED, search_text, tokenize='porter')`);
  return db;
}

export interface UpsertInput {
  forum: string;
  lane: string;
  posts: FmkoreaPost[];
  nowIso: string;
  /** Tier0 정규화(선택) — 제목 → {tickers, sentiment}. 있으면 적재 시 태깅(무LLM). */
  normalize?: (title: string) => { tickers: string[]; sentiment: number | null };
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  insertedIds: string[]; // 이번에 신규 적재된 id(Tier1 판정 대상)
  /** 버즈 상위 — velocity × freshness(세션인지) × 가속부스트. 신선도가 중요도 인자(대표 지시). */
  hot: Array<{ id: string; title: string; metric: number; velocity: number; accel: number; freshness: number; buzzScore: number; category: string }>;
}

/** 글 upsert + 스냅샷 + velocity(engagement 델타) + buzzScore(velocity×freshness).
 *  engagement metric = views(firehose) ?? recommends(popular). 신선한 글의 급등을 더 높게. */
export function upsertPosts(db: Database, input: UpsertInput): UpsertResult {
  const { forum, lane, posts, nowIso } = input;
  const nowMs = Date.parse(nowIso);
  const halflife = sessionHalflifeMin(nowMs); // ② 세션인지 반감기(장중 20분·야간 120분)
  let inserted = 0, updated = 0;
  const hot: UpsertResult['hot'] = [];
  const insertedIds: string[] = [];

  const selPrev = db.prepare('SELECT views, recommends, velocity FROM buzz_posts WHERE id = ?');
  const insPost = db.prepare(`INSERT INTO buzz_posts(id, ts, fetch_ts, forum, lane, category, author, title, url, posted_at, views, recommends, comments, velocity, accel, tickers, sentiment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const updPost = db.prepare(`UPDATE buzz_posts SET fetch_ts=?, views=?, recommends=?, comments=?, velocity=?, accel=?, lane=?, category=?, posted_at=? WHERE id=?`);
  const insSnap = db.prepare('INSERT INTO buzz_snapshots(post_id, ts, views, recommends, comments) VALUES (?,?,?,?,?)');
  const insFts = db.prepare('INSERT INTO buzz_fts(id, search_text) VALUES (?,?)');

  // engagement metric — firehose=조회, popular=추천(조회 없음).
  const metricOf = (p: FmkoreaPost): number => p.views ?? p.recommends ?? 0;

  const tx = db.transaction(() => {
    for (const p of posts) {
      const id = `${forum}:${p.postId}`;
      const metric = metricOf(p);
      const prev = selPrev.get(id) as { views: number | null; recommends: number | null; velocity: number | null } | undefined;
      if (prev) {
        const prevMetric = p.views != null ? (prev.views ?? 0) : (prev.recommends ?? 0);
        const velocity = Math.max(0, metric - prevMetric);
        const accel = velocity - (prev.velocity ?? 0); // ② 가속 = Δvelocity(양수=가속중=더 뜨거움)
        updPost.run(nowIso, p.views, p.recommends, p.comments ?? null, velocity, accel, lane, p.category, p.postedAt, id);
        updated++;
        if (velocity > 0) {
          const freshness = freshnessScore(p.postedAt, nowMs, halflife); // 세션인지 반감기
          // 신선도 가중(0.4바닥+0.6freshness) × 가속부스트(가속중이면 최대 +50%).
          const accelBoost = accel > 0 ? 1 + Math.min(0.5, accel / Math.max(1, velocity)) : 1;
          const buzzScore = Math.round(velocity * (0.4 + 0.6 * freshness) * accelBoost * 100) / 100;
          hot.push({ id, title: p.title, metric, velocity, accel, freshness: Math.round(freshness * 100) / 100, buzzScore, category: p.category });
        }
      } else {
        const norm = input.normalize?.(p.title);
        const tickers = norm?.tickers.length ? norm.tickers.join(',') : null;
        insPost.run(id, nowIso, nowIso, forum, lane, p.category, p.author, p.title, p.url, p.postedAt, p.views, p.recommends, p.comments ?? null, 0, 0, tickers, norm?.sentiment ?? null);
        insFts.run(id, `${p.title} ${p.category}${tickers ? ' ' + tickers : ''}`);
        inserted++; insertedIds.push(id);
      }
      insSnap.run(id, nowIso, p.views, p.recommends, p.comments ?? null);
    }
  });
  tx();

  hot.sort((a, b) => b.buzzScore - a.buzzScore); // 신선도 가중 버즈 순
  return { inserted, updated, insertedIds, hot: hot.slice(0, 10) };
}

export interface Judgment { id: string; importance: number; spam: boolean; polarity: number | null; reason: string }

/** Tier1 판정 결과 적재 — importance/spam/sentiment/reason. sentiment 는 Tier0 우선(있으면 유지). */
export function applyJudgments(db: Database, judgments: Judgment[]): number {
  const upd = db.prepare(`UPDATE buzz_posts SET importance=?, spam=?, reason=?, sentiment=COALESCE(sentiment, ?) WHERE id=?`);
  const tx = db.transaction(() => { for (const j of judgments) upd.run(j.importance, j.spam ? 1 : 0, j.reason, j.polarity, j.id); });
  tx();
  return judgments.length;
}

/** raw 글/스냅샷 TTL prune(기본 48h). digested/alerted(중요)은 보존. */
export function pruneOldBuzz(db: Database, hours = 48): number {
  const cutoff = `-${hours} hours`;
  db.run(`DELETE FROM buzz_snapshots WHERE ${olderThan('ts')}`, [cutoff]);
  const r = db.run(`DELETE FROM buzz_posts WHERE ${olderThan('fetch_ts')} AND digested=0 AND alerted=0`, [cutoff]);
  return r.changes;
}
