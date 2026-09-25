// ── 통합 시그널 보드 API — GET /v1/signals/board (2026-07-10) ─────────────────
//
// signal-board.ts 순수 집계기에 실 수집기를 배선한다. 각 소스 fail-soft(하나 실패해도
// 나머지 집계). 버즈·디깅·타임라인·국면·회고 4소스를 최신순 통합 피드 + 국면/캡스톤 hero.

import { existsSync } from 'node:fs';
import { openBuzzDb } from '../../domains/community-buzz/store.js';
import { emergingTickers } from '../../domains/community-buzz/novelty.js';
import { emergedSentiments } from '../../domains/community-buzz/validate.js';
import { dashboardDigs, dashboardTimeline, dashboardSummary } from '../../domains/dashboard-data.js';
import { openRegimeDb, latestRegimeVector, recentRegimeVectors, REGIME_DB_PATH } from '../../domains/regime-store.js';
import { openSurfaceEventsDb, surfaceEventsDbPath } from '../../domains/surface-events.js';
import { AUTONOMY_DOMAIN, AUTONOMY_KIND } from '../../domains/autonomy-log.js';
import { buildSignalBoard, type SignalBoard, type ReflectionHitLike } from '../../domains/signal-board.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function soft<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }

/** 회고/기억 루프 최근 자율행동 — surface_events 직접 조회(FTS 우회·robust). loop:replay/retro 만. */
function collectReflectionHits(limit = 8): ReflectionHitLike[] {
  return soft(() => {
    if (!existsSync(surfaceEventsDbPath())) return [];
    const db = openSurfaceEventsDb();
    try {
      const rows = db.prepare(
        `SELECT ts, summary, text, tags FROM events WHERE domain=? AND kind=? ORDER BY ts DESC LIMIT 40`,
      ).all(AUTONOMY_DOMAIN, AUTONOMY_KIND) as Array<{ ts: string; summary: string | null; text: string; tags: string | null }>;
      return rows
        .filter(r => { const t = r.tags ?? ''; return t.includes('loop:replay') || t.includes('loop:retro'); })
        .slice(0, limit);
    } finally { db.close(); }
  }, []);
}

/** 실 수집 → 순수 집계기. 각 소스 독립 fail-soft. */
export function collectSignalBoard(opts: { feedLimit?: number; nowIso?: string } = {}): SignalBoard {
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const { emerging, sentiments } = soft(() => {
    const db = openBuzzDb();
    try {
      const em = emergingTickers(db, { recentHours: 6, baselineHours: 48, minRecent: 3 });
      const se = emergedSentiments(db, { hours: 48, minPosts: 2 }).map(s => ({ ticker: s.ticker, sentiment: s.sentiment }));
      return { emerging: em, sentiments: se };
    } finally { db.close(); }
  }, { emerging: [], sentiments: [] as Array<{ ticker: string; sentiment: number }> });

  const digs = soft(() => dashboardDigs(10) as Array<{ id?: string; ts: string; topic?: string; sector?: string; verdict?: string; confidence?: number }>, []);
  const timeline = soft(() => dashboardTimeline(48, 6) as Array<Record<string, unknown>>, []) as Array<{ ts: string }>;
  const summary = soft(() => dashboardSummary() as { capstone?: Record<string, unknown> | null }, null);

  const { regimeRecent, regimeLatest } = soft(() => {
    if (!existsSync(REGIME_DB_PATH)) return { regimeRecent: [], regimeLatest: null };
    const db = openRegimeDb();
    try { return { regimeRecent: recentRegimeVectors(db, 10) as never[], regimeLatest: latestRegimeVector(db) as never }; }
    finally { db.close(); }
  }, { regimeRecent: [], regimeLatest: null });

  return buildSignalBoard({
    emerging,
    sentiments,
    digs,
    timeline: timeline as never[],
    regimeRecent: regimeRecent as never[],
    regimeLatest: regimeLatest as never,
    capstone: summary?.capstone ?? null,
    reflectionHits: collectReflectionHits(8),
    nowIso,
    ...(opts.feedLimit ? { feedLimit: opts.feedLimit } : {}),
  });
}

export function handleSignalBoard(req: Request): Response {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', ...CORS } });
  const url = new URL(req.url);
  const feedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const board = collectSignalBoard(Number.isFinite(feedLimit) && feedLimit > 0 ? { feedLimit } : {});
  return new Response(JSON.stringify({ ok: true, board }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
}
