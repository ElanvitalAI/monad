// ── 선제적 능동 회상(self-query) — ANS 축B B1b ────────────────────────────────
// PLAN-agentic-neural-substrate-2026-07-17 §3 B1. 축B 는 replay(강화)·느린복원·RIF·
// reconsolidation 을 이미 배선했으나, "판단 시점에 관련 과거를 스스로 소환"하는 proactive
// self-query 는 미배선(reactive 만)이었다. 이 모듈이 그 마지막 조각.
//
// 핵심: 회상(recall)이 곧 강화 — recallEvents 의 bump 가 retrieval practice = recall_count++.
// 판단/제안 전에 관련 과거를 능동 소환하면 (1) 문맥 주입 + (2) 그 기억이 강화된다(공짜).
//
// 안전: read-only 조회 + recall_count 증분(강화)뿐 — 미션 DB·매매 무접촉. fail-soft. 관측 남김.

import { Database } from 'bun:sqlite';
import { debug } from '../debug/log.js';
import { openSurfaceEventsDb, recallEvents, type RecallHit } from './surface-events.js';

export interface ProactiveRecallOpts {
  /** FTS 질의(판단 대상·예: 골 요약·미션 도메인 키워드). */
  query?: string;
  domain?: string;
  category?: string;
  limit?: number;      // 기본 5
  sinceHours?: number; // 기본 recallEvents(168=7일)
  nowMs?: number;      // 테스트 seam
  /** 강화 여부 — 기본 true(선제 회상은 retrieval practice=강화). 순수 진단만 false. */
  bump?: boolean;
}

export interface ProactiveRecallResult {
  hits: RecallHit[];
  /** 프롬프트/워킹메모리 주입용 블록("" = 관련 과거 없음·무노이즈). */
  block: string;
}

/** 상대 시간 라벨(h/d) — 주입 블록 가독성. 순수. */
function relTime(ts: string, nowMs: number): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const h = Math.max(0, Math.round((nowMs - t) / 3.6e6));
  return h < 48 ? `${h}h전` : `${Math.round(h / 24)}d전`;
}

/** 회상 hits → 주입 블록. top-5·텍스트 압축·시각/도메인 태그. 순수. */
export function formatRecallBlock(hits: readonly RecallHit[], nowMs: number = Date.now()): string {
  if (!hits.length) return '';
  const lines = hits.slice(0, 5).map((h) => {
    const when = relTime(h.ts, nowMs);
    const dom = h.domain ? ` #${h.domain}` : '';
    const body = (h.summary || h.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `- (${when}${dom}) ${body}`;
  });
  return ['[선제 회상 — 관련 과거(판단 전 자동 소환)]', ...lines].join('\n');
}

/** 판단/제안 전 선제적 self-query(축B B1b) — 관련 과거를 능동 회상(bump=강화)해 주입 블록 생성.
 *  reactive("물으면 회상")가 아니라 proactive(판단 시점에 스스로 소환). db 주입(테스트 seam)·관측. */
export function proactiveRecall(db: Database, opts: ProactiveRecallOpts = {}): ProactiveRecallResult {
  const limit = opts.limit ?? 5;
  const hits = recallEvents(db, {
    ...(opts.query ? { query: opts.query } : {}),
    ...(opts.domain ? { domain: opts.domain } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.sinceHours ? { sinceHours: opts.sinceHours } : {}),
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
    limit,
    bump: opts.bump ?? true, // 선제 회상 = 강화(retrieval practice). 진단만 false.
  });
  const block = formatRecallBlock(hits, opts.nowMs ?? Date.now());
  debug.log('memory.proactive-recall', opts.query || opts.domain || 'ambient', {
    query: opts.query, domain: opts.domain, hits: hits.length, bumped: opts.bump ?? true,
  });
  return { hits, block };
}

/** 기본 surface_events DB 로 선제 회상(fail-soft·ambient/판단시점 편의). db 자동 open/close. */
export function proactiveRecallBlock(opts: ProactiveRecallOpts = {}): string {
  try {
    const db = openSurfaceEventsDb();
    try {
      return proactiveRecall(db, opts).block;
    } finally {
      db.close();
    }
  } catch {
    return '';
  }
}
