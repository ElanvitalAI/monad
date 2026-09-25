// ── 종목 발굴 폐루프 — emergence → dig → 매력도 · 버즈 P4 · 2026-07-09 ─────────
//
// PLAN §5-⑤. 커뮤니티에서 급부상한 티커(ticker_emergence)를 발굴 후보로:
//  ① dig_queue 적재(forum-discovery) → 기존 dig-runner 가 심층분석(read-only)
//  ② asset-attractiveness scores.db 최신 스코어 조회(read-only·강제 재계산 안 함)
//  ③ 발굴 리포트(급부상+lead/lag novelty+매력도 signal) → HITL. 매매 격리.

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { timeKey, within } from '../../time/db-window.js';

const SCORES_DB = join(homedir(), '.cache/asset-attractiveness/scores.db');

export interface DiscoveryCandidate {
  ticker: string;
  ratio: number;
  recent: number;
  novelty: number | null;
  leadLag: string | null;
  example: string | null;
}

/** ticker_emergence → 최근 급부상 종목(티커별 최신·ratio 내림차순). */
export function discoveryCandidates(db: Database, opts: { hours?: number; minRatio?: number; limit?: number } = {}): DiscoveryCandidate[] {
  const hours = opts.hours ?? 24, minRatio = opts.minRatio ?? 2.5, limit = opts.limit ?? 10;
  // ⚠️ 최신행 선택도 정규화한다(리뷰 should-fix) — `MAX(ts)` 는 **문자열 최대**라 저장 형식이
  //    섞이면 ISO(`T`)가 SQLite 형식(공백)을 항상 이겨서 **엉뚱한 행이 최신**이 된다.
  //    비교 양쪽을 같은 축으로 맞춰야 등호가 성립한다.
  // ⚠️ 축은 `datetime()` 이 아니라 `timeKey()`(julianday) 다 — `datetime()` 은 **초 단위로 잘라서**
  //    같은 초의 여러 행이 전부 '최신' 이 되고, 뒤의 GROUP BY 가 그중 임의 행을 고른다.
  const rows = db.prepare(
    `SELECT ticker, ratio, recent, novelty, lead_lag, example
     FROM ticker_emergence e
     WHERE ${within('ts')} AND ratio >= ?
       AND ${timeKey('ts')} = (SELECT MAX(${timeKey('ts')}) FROM ticker_emergence WHERE ticker = e.ticker AND ${within('ts')})
     GROUP BY ticker ORDER BY ratio DESC LIMIT ?`,
  ).all(`-${hours} hours`, minRatio, `-${hours} hours`, limit) as Array<{ ticker: string; ratio: number; recent: number; novelty: number | null; lead_lag: string | null; example: string | null }>;
  return rows.map(r => ({ ticker: r.ticker, ratio: r.ratio, recent: r.recent, novelty: r.novelty, leadLag: r.lead_lag, example: r.example }));
}

/** dig_queue 적재(forum-discovery). 기존 dig-runner 가 심층분석. 신규 적재 건수 반환. */
export function enqueueForumDiscovery(digDb: Database, candidates: DiscoveryCandidate[], nowIso: string): number {
  const ins = digDb.prepare(`INSERT OR IGNORE INTO dig_queue(id, topic, sector, score, created_at) VALUES (?,?,?,?,?)`);
  const day = nowIso.slice(0, 10);
  let n = 0;
  for (const c of candidates) {
    const id = `forum:${c.ticker}:${day}`;
    const topic = `커뮤니티 급부상: ${c.ticker} x${c.ratio}(${c.recent}건)${c.leadLag ? ` · ${c.leadLag}` : ''} — ${(c.example ?? '').slice(0, 50)}`;
    const score = Math.min(8, Math.max(1, Math.round(c.ratio * 2)));
    if (ins.run(id, topic, c.ticker, score, nowIso).changes) n++;
  }
  return n;
}

export interface Attractiveness { signal: string; score: number; asOf: string }

/** 매력도 최신 스코어 조회(read-only·강제 재계산 안 함). 미채점=null. */
export function lookupAttractiveness(ticker: string, dbPath = SCORES_DB): Attractiveness | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const r = db.query(`SELECT signal, total_score, as_of FROM scores WHERE symbol=? ORDER BY as_of DESC LIMIT 1`).get(ticker) as { signal: string | null; total_score: number; as_of: string } | null;
    return r ? { signal: r.signal ?? 'HOLD', score: Math.round(r.total_score * 10) / 10, asOf: r.as_of } : null;
  } catch { return null; } finally { db.close(); }
}

/** 발굴 리포트(순수) — 급부상 + lead/lag + 매력도 signal. null 이면 발송 안 함. */
export function formatDiscoveryReport(candidates: DiscoveryCandidate[], attract: Map<string, Attractiveness | null>): string | null {
  if (candidates.length === 0) return null;
  const lines = [`🔎 커뮤니티 종목 발굴 — 급부상 ${candidates.length}종 (에펨코리아·매매 격리)`];
  for (const c of candidates) {
    const a = attract.get(c.ticker);
    const aStr = a ? ` · 매력도 ${a.signal}(${a.score})` : ' · 매력도 미채점';
    const ll = c.leadLag ? ` · ${c.leadLag}` : '';
    lines.push(`\n• ${c.ticker} x${c.ratio}(${c.recent}건)${ll}${aStr}`);
    if (c.example) lines.push(`  "${c.example.slice(0, 46)}"`);
  }
  return lines.join('\n');
}
