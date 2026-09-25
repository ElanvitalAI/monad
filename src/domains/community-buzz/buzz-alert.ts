// ── 버즈 알림 — 중요만 발송(대표 요구: 중요만 알림·나머지 필터) · P3a · 2026-07-09 ─
//
// PLAN §5-②. Tier1 판정 importance 높은 신규 글만 알림. sendOutbound(조용시간·리포트채널)
// 재사용. 6h 유사중복 억제(isNearDuplicate) + 사이클당 상한 + alerted 플래그(1회성).

import type { Database } from 'bun:sqlite';
import { isNearDuplicate } from '../breaking-signals.js';
import { within } from '../../time/db-window.js';

export interface AlertCandidate {
  id: string;
  title: string;
  tickers: string | null;
  importance: number;
  sentiment: number | null;
  reason: string | null;
  category: string | null;
  url: string | null;
}

/** 알림 후보 — importance≥floor·非spam·미알림·최근. buzz(velocity) 높은 순. */
export function alertCandidates(db: Database, opts: { minImportance?: number; hours?: number; limit?: number } = {}): AlertCandidate[] {
  const floor = opts.minImportance ?? 8, hours = opts.hours ?? 3, limit = opts.limit ?? 8;
  return db.prepare(
    `SELECT id, title, tickers, importance, sentiment, reason, category, url
     FROM buzz_posts
     WHERE alerted=0 AND spam=0 AND importance >= ? AND ${within('fetch_ts')}
     ORDER BY importance DESC, velocity DESC LIMIT ?`,
  ).all(floor, `-${hours} hours`, limit) as AlertCandidate[];
}

/** 최근 알림된 제목(6h) — 유사중복 억제 기준. */
export function recentAlertedTitles(db: Database, hours = 6): string[] {
  return (db.prepare(`SELECT title FROM buzz_posts WHERE alerted=1 AND ${within('fetch_ts')}`).all(`-${hours} hours`) as Array<{ title: string }>).map(r => r.title);
}

export function markAlerted(db: Database, ids: string[]): void {
  if (!ids.length) return;
  const upd = db.prepare(`UPDATE buzz_posts SET alerted=1 WHERE id=?`);
  const tx = db.transaction(() => { for (const id of ids) upd.run(id); });
  tx();
}

/** 최근 알림·후보 간 유사중복 제거(순수). recent 대비 + 후보 상호. */
export function filterNewAlerts(candidates: AlertCandidate[], recentTitles: string[]): AlertCandidate[] {
  const kept: AlertCandidate[] = [];
  for (const c of candidates) {
    if (recentTitles.some(t => isNearDuplicate(c.title, t))) continue;    // 최근 알림과 중복
    if (kept.some(k => isNearDuplicate(c.title, k.title))) continue;      // 후보 상호 중복
    kept.push(c);
  }
  return kept;
}

/** 알림 텍스트(순수) — 중요만 요약. null 이면 발송 안 함. */
export function formatBuzzAlert(candidates: AlertCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const deEscape = (s: string): string => s.replace(/\\([[\]()])/g, '$1'); // fmkorea 마크다운 이스케이프 정리
  const lines = [`🔔 커뮤니티 버즈 — 중요 ${candidates.length}건 (에펨코리아)`];
  for (const c of candidates) {
    const tk = c.tickers ? ` (${c.tickers})` : '';
    const s = c.sentiment != null ? (c.sentiment > 0.2 ? '📈' : c.sentiment < -0.2 ? '📉' : '') : '';
    lines.push(`\n• [중요도 ${c.importance}${s ? ` ${s}` : ''}]${tk} ${deEscape(c.title).slice(0, 60)}`);
    if (c.reason) lines.push(`  → ${c.reason.slice(0, 70)}`);
    if (c.url) lines.push(`  ${c.url}`);
  }
  return lines.join('\n');
}
