// ── Dislocation detection (P3b, 2026-07-05) ────────────────────────────
//
// A "dislocation" is where the deterministic market backbone (market_yahoo,
// X-lag-free) and the X-crowd sentiment (tweets_md_score) DISAGREE for an
// asset class. The backbone is the 1급 anchor; sentiment alone validated
// worse-than-random. So a dislocation is NOT a trade signal — it's a
// "look here" flag: the crowd and the tape are telling different stories,
// which is exactly the kind of thing worth a human glance (verify + HITL).
//
// Both signals live in x_asset.db fact_signal_daily on the SAME −100..100
// scale and share asset-class scope_keys, so the comparison is apples-to-
// apples. Sentiment freshness is a hard prerequisite — see the scoring-step
// fix (collect-x-sentiment.sh · score_from_md.py). Read-only, fail-soft.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const X_ASSET_DB = join(homedir(), '.claude/skills/apify-x-asset-sentiment/data/x_asset.db');

/** Gap thresholds (points on the shared −100..100 scale). */
const STRONG_GAP = 50;
const MODERATE_GAP = 30;
/** Min |score| on each side for a sign-disagreement to count (filters noise
 *  around zero where a tiny +/− flip isn't a real divergence). */
const MEANINGFUL = 15;

export type DislocationSeverity = 'strong' | 'moderate' | 'aligned';

export interface Dislocation {
  asset: string;
  backbone: number;
  backboneDir: string;
  sentiment: number;
  sentimentDir: string;
  /** sentiment − backbone (positive = crowd more bullish than the tape). */
  gap: number;
  /** true when backbone and sentiment carry opposite signs, both meaningful. */
  signDisagree: boolean;
  severity: DislocationSeverity;
}

/** Pure classifier — no DB, unit-testable. Decides how far apart the tape
 *  and the crowd are for one asset class. */
export function classifyDislocation(backbone: number, sentiment: number): {
  gap: number;
  signDisagree: boolean;
  severity: DislocationSeverity;
} {
  const gap = Math.round((sentiment - backbone) * 10) / 10;
  const absGap = Math.abs(gap);
  const signDisagree =
    Math.sign(backbone) !== 0 && Math.sign(sentiment) !== 0 &&
    Math.sign(backbone) !== Math.sign(sentiment) &&
    Math.abs(backbone) >= MEANINGFUL && Math.abs(sentiment) >= MEANINGFUL;

  let severity: DislocationSeverity = 'aligned';
  if (absGap >= STRONG_GAP) severity = 'strong';
  else if (absGap >= MODERATE_GAP || (signDisagree && absGap >= 20)) severity = 'moderate';

  return { gap, signDisagree, severity };
}

interface Row { scope_key: string; bscore: number; bdir: string; sscore: number; sdir: string }

/** Read the latest backbone vs sentiment per asset class and classify each.
 *  Returns [] when the DB is absent or the sources don't intersect (fail-soft).
 *  Sorted by severity then |gap| descending (most dislocated first). */
export function computeDislocations(): Dislocation[] {
  if (!existsSync(X_ASSET_DB)) return [];
  let raw = '';
  try {
    raw = execFileSync('sqlite3', ['-json', X_ASSET_DB,
      "WITH bb AS (SELECT scope_key, score bscore, direction bdir FROM fact_signal_daily " +
      "WHERE signal_source='market_yahoo' AND date=(SELECT MAX(date) FROM fact_signal_daily WHERE signal_source='market_yahoo')), " +
      "st AS (SELECT scope_key, score sscore, direction sdir FROM fact_signal_daily " +
      "WHERE signal_source='tweets_md_score' AND date=(SELECT MAX(date) FROM fact_signal_daily WHERE signal_source='tweets_md_score')) " +
      "SELECT bb.scope_key, bb.bscore, bb.bdir, st.sscore, st.sdir FROM bb JOIN st ON bb.scope_key=st.scope_key;",
    ], { encoding: 'utf-8', timeout: 15_000, maxBuffer: 1_000_000 }).trim();
  } catch { return []; }
  if (!raw) return [];

  let rows: Row[];
  try { rows = JSON.parse(raw) as Row[]; } catch { return []; }

  const out: Dislocation[] = rows.map(r => {
    const { gap, signDisagree, severity } = classifyDislocation(r.bscore, r.sscore);
    return {
      asset: r.scope_key,
      backbone: Math.round(r.bscore * 10) / 10,
      backboneDir: r.bdir,
      sentiment: Math.round(r.sscore * 10) / 10,
      sentimentDir: r.sdir,
      gap, signDisagree, severity,
    };
  });

  const rank: Record<DislocationSeverity, number> = { strong: 0, moderate: 1, aligned: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.gap) - Math.abs(a.gap));
}

const ARROW: Record<string, string> = { up: '↑', down: '↓' };
const dir = (d: string): string => ARROW[d] ?? '·';

/** One-line-per-asset dislocation summary (strong + moderate only). Returns
 *  '' when nothing is dislocated — callers omit the section entirely then. */
export function renderDislocationSection(dislocations: Dislocation[]): string {
  const flagged = dislocations.filter(d => d.severity !== 'aligned');
  if (flagged.length === 0) return '';
  const lines = flagged.map(d => {
    const mark = d.severity === 'strong' ? '🔴' : '🟡';
    const tag = d.signDisagree ? ' (부호 반대)' : '';
    return `  ${mark} ${d.asset}: 실측 ${d.backbone >= 0 ? '+' : ''}${d.backbone}${dir(d.backboneDir)} vs 센티 ${d.sentiment >= 0 ? '+' : ''}${d.sentiment}${dir(d.sentimentDir)} · gap ${d.gap >= 0 ? '+' : ''}${d.gap}${tag}`;
  });
  return `\n⚠️ *센티-실측 괴리* (관찰용 · 매매 아님)\n${lines.join('\n')}\n  _실측(backbone)이 1급 근거. 괴리=크라우드와 시장이 다른 이야기 → verify+HITL._`;
}
