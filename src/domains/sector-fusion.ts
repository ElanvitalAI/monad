// ── Sector fusion (P3c, 2026-07-05) ────────────────────────────────────
//
// Two SEPARATE sector lenses existed and had to be cross-read by hand:
//   • PRICE momentum   — cross_asset_scores 'sector-global' (11 GICS ETFs,
//     real-time price-based rotation rank). "지금 강한 섹터."
//   • INSTITUTIONAL flow — 13F QoQ net_B per sector (dim_security · 45-day
//     lag). "기관이 실제로 돈을 어디로 옮겼나."
//
// This fuses them. The INTERESTING cases are where they DISAGREE — the same
// price-vs-smart-money divergence idea as the asset-class dislocation (P3b),
// one layer down at the sector level:
//   • price strong + institutions selling → DISTRIBUTION (momentum without
//     smart money — caution). e.g. Financials rank#1 but 13F net −$3.6B.
//   • price weak + institutions buying   → ACCUMULATION (smart money ahead of
//     price). e.g. Energy rank#11 but 13F net +$11.8B.
// Neither is a trade signal — backbone/price is 1급, 13F lags. It's a "look
// here" flag (verify + HITL). Read-only, fail-soft.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { knowledge13fDbPath } from './sec-13f.js';
import { join } from 'node:path';

const HOME = homedir();
const SCORES_DB = join(HOME, '.cache/asset-attractiveness/scores.db');

/** price-lens sector key (cross_asset_scores) → 13F-lens sector name
 *  (dim_security · Yahoo/Morningstar taxonomy). 11 GICS sectors, 1:1. */
const SECTOR_MAP: Record<string, string> = {
  financials: 'Financial Services',
  industrials: 'Industrials',
  healthcare: 'Healthcare',
  consumer_staples: 'Consumer Defensive',
  real_estate: 'Real Estate',
  materials: 'Basic Materials',
  technology: 'Technology',
  comm_services: 'Communication Services',
  utilities: 'Utilities',
  consumer_disc: 'Consumer Cyclical',
  energy: 'Energy',
};

/** Price rank considered "strong" (top of an 11-sector board) / "weak". */
const STRONG_RANK = 4;
const WEAK_RANK = 8;
/** Institutional QoQ flow (net_B) magnitude that counts as a real move. */
const FLOW_MEANINGFUL = 1.0;

export type SectorFusionLabel =
  | 'confirmed'    // price strong + inflow  🟢
  | 'distribution' // price strong + outflow 🟡  (divergence — caution)
  | 'accumulation' // price weak   + inflow  🔵  (divergence — smart money early)
  | 'capitulation' // price weak   + outflow 🔴
  | 'neutral';     // anything below the thresholds

export interface SectorFusion {
  sector: string;      // price-lens key (e.g. 'energy')
  rank: number;        // 1..11 price momentum rank (1 = strongest)
  price: number;       // price rotation score
  netB: number;        // 13F QoQ net flow, $B (positive = institutions buying)
  label: SectorFusionLabel;
  /** true when the two lenses point opposite ways (the notable cases). */
  divergent: boolean;
}

/** Pure classifier — no DB. Fuses one sector's price rank + institutional flow. */
export function classifySectorFusion(rank: number, netB: number): {
  label: SectorFusionLabel;
  divergent: boolean;
} {
  const strongPrice = rank <= STRONG_RANK;
  const weakPrice = rank >= WEAK_RANK;
  const inflow = netB >= FLOW_MEANINGFUL;
  const outflow = netB <= -FLOW_MEANINGFUL;

  if (strongPrice && inflow) return { label: 'confirmed', divergent: false };
  if (strongPrice && outflow) return { label: 'distribution', divergent: true };
  if (weakPrice && inflow) return { label: 'accumulation', divergent: true };
  if (weakPrice && outflow) return { label: 'capitulation', divergent: false };
  return { label: 'neutral', divergent: false };
}

function sqliteJson(db: string, query: string): unknown[] {
  try {
    const raw = execFileSync('sqlite3', ['-json', db, query], {
      encoding: 'utf-8', timeout: 15_000, maxBuffer: 2_000_000,
    }).trim();
    return raw ? JSON.parse(raw) as unknown[] : [];
  } catch { return []; }
}

/** Read both lenses, map + join by sector, classify each. Returns [] when a
 *  DB is missing or the lenses don't intersect (fail-soft). Sorted:
 *  divergent first, then by |netB| descending (biggest institutional moves). */
export function computeSectorFusion(): SectorFusion[] {
  const KNOWLEDGE_DB = knowledge13fDbPath(); // M0.1: 13F DB(구 ~/.elanous/knowledge.db) 분리 · state-dir lazy
  if (!existsSync(SCORES_DB) || !existsSync(KNOWLEDGE_DB)) return [];

  // Price lens — latest sector-global board. asset_class='technology' is a
  // stable member used to resolve the preset_hash (3-preset coexistence).
  const priceRows = sqliteJson(SCORES_DB,
    "WITH h AS (SELECT preset_hash FROM cross_asset_scores WHERE asset_class='technology' ORDER BY as_of DESC LIMIT 1) " +
    "SELECT asset_class AS sector, rank, round(score,1) AS price FROM cross_asset_scores " +
    "WHERE preset_hash=(SELECT preset_hash FROM h) " +
    "AND as_of=(SELECT max(as_of) FROM cross_asset_scores WHERE preset_hash=(SELECT preset_hash FROM h));",
  ) as Array<{ sector: string; rank: number; price: number }>;
  if (priceRows.length === 0) return [];

  // Institutional lens — 13F QoQ net delta per sector (each fund's latest 2
  // filings). Mirrors finance_13f_sectors' flow CTE.
  const flowRows = sqliteJson(KNOWLEDGE_DB,
    "WITH per AS (SELECT cik, period, substr(replace(cusip,' ',''),1,8) AS c8, SUM(value) AS v FROM fact_13f_holdings GROUP BY cik, period, c8), " +
    "ranked AS (SELECT cik, c8, v, DENSE_RANK() OVER (PARTITION BY cik ORDER BY period DESC) rk FROM per), " +
    "keys AS (SELECT DISTINCT cik, c8 FROM ranked WHERE rk<=2), " +
    "delta AS (SELECT k.c8, COALESCE((SELECT v FROM ranked WHERE cik=k.cik AND c8=k.c8 AND rk=1),0) - COALESCE((SELECT v FROM ranked WHERE cik=k.cik AND c8=k.c8 AND rk=2),0) AS d FROM keys k) " +
    "SELECT COALESCE(NULLIF(TRIM(ds.sector),''),'Unknown') AS sector, round(SUM(d)/1e9,2) AS net_B " +
    "FROM delta LEFT JOIN dim_security ds ON delta.c8=ds.cusip8 GROUP BY 1;",
  ) as Array<{ sector: string; net_B: number }>;
  const flowByName = new Map(flowRows.map(r => [r.sector, r.net_B]));

  const out: SectorFusion[] = [];
  for (const p of priceRows) {
    const yahooName = SECTOR_MAP[p.sector];
    if (!yahooName) continue; // non-GICS row (shouldn't happen for sector-global)
    const netB = flowByName.get(yahooName) ?? 0;
    const { label, divergent } = classifySectorFusion(p.rank, netB);
    out.push({ sector: p.sector, rank: p.rank, price: p.price, netB, label, divergent });
  }

  return out.sort((a, b) => Number(b.divergent) - Number(a.divergent) || Math.abs(b.netB) - Math.abs(a.netB));
}

const LABEL_MARK: Record<SectorFusionLabel, string> = {
  confirmed: '🟢 확증(가격강+기관매수)',
  distribution: '🟡 분산(가격강+기관매도·주의)',
  accumulation: '🔵 축적(가격약+기관매수·선행)',
  capitulation: '🔴 동반약세(가격약+기관매도)',
  neutral: '⚪ 중립',
};

/** Fused table — one line per sector, divergent (distribution/accumulation)
 *  first. Always returns a body (unlike dislocation) since sectors are a fixed
 *  set; callers show it as an on-demand tool, not a conditional alert. */
export function renderSectorFusion(rows: SectorFusion[]): string {
  if (rows.length === 0) return '(sector-global 또는 13F 데이터 없음)';
  const lines = rows.map(r =>
    `  #${r.rank} ${r.sector}: 가격 ${r.price} · 기관 ${r.netB >= 0 ? '+' : ''}${r.netB}B → ${LABEL_MARK[r.label]}`,
  );
  return lines.join('\n');
}
