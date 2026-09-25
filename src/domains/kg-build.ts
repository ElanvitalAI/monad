// ── 온톨로지 빌드 + 이상치→dig 훅 (M5 P9 · R5 · 2026-07-08) ───────────────
//
// 배치 오케스트레이터: seed(구조·한미·테마) + correlate(측정 weight) → knowledge.db
// kg 테이블 구축. + 이상치 폐루프(R5): 예측 vs 실측 → residual 이상치 → dig 후보.
//
// 거버넌스: 빌드=READ(가격) WRITE(kg only·매매 격리). 이상치 자동 dig 는 대표 게이트
// (기본 관측만·enqueue=false). LLM 미사용(deterministic).

import { Database } from 'bun:sqlite';
import { openKgDb, listNodes, kgStats } from './kg-store.js';
import { seedAll, type SeedCounts, type CrossSeedCounts } from './kg-seed.js';
import { correlateAndStore } from './kg-correlate.js';
import { expectedReaction, residualOf, type ResidualOpts } from './kg-infer.js';
import { ensureDigTables } from './dig-engine.js';

export interface BuildResult {
  seed: SeedCounts & CrossSeedCounts;
  correlate: { crossMarket: number; groups: number };
  stats: { nodes: number; edges: number; activeEdges: number };
}

/** 온톨로지 구축(배치) — seed + 상관 측정. db 미지정 시 실 knowledge.db. */
export function buildOntology(
  now: string,
  opts: { db?: Database; regime?: string; fromDate?: string; window?: number; minAbsCorr?: number } = {},
): BuildResult {
  const db = opts.db ?? openKgDb();
  const seed = seedAll(db, now);
  const correlate = correlateAndStore(db, { now, regime: opts.regime, fromDate: opts.fromDate, window: opts.window, minAbsCorr: opts.minAbsCorr });
  return { seed, correlate, stats: kgStats(db) };
}

export interface AnomalyCandidate {
  trigger: string; node: string; symbol: string;
  direction: -1 | 0 | 1; strength: number; expectedPct: number; actualPct: number; residual: number;
}

export interface AnomalyOpts {
  triggers?: string[];          // 미지정 시 event/policy 노드 전부
  regime?: string;
  minStrength?: number;         // 이 이상 예측만(기본 0.2)
  actualResolver: (symbol: string, etaDays: number) => number | null;  // 실측 % (주입/로더)
  residualOpts?: ResidualOpts;
}

/** 이상치 폐루프(R5) — 트리거 예측 vs 실측 → residual 이상치 후보. 순수(actual 주입).
 *  예측대로면 조용, 예측 깨면 후보(디깅). enqueue 는 별도(대표 게이트). */
export function detectAnomalies(db: Database, opts: AnomalyOpts): AnomalyCandidate[] {
  const { regime, minStrength = 0.2, actualResolver, residualOpts } = opts;
  const triggers = opts.triggers ?? [...listNodes(db, { }).filter(n => n.kind === 'event' || n.kind === 'policy').map(n => n.id)];
  const out: AnomalyCandidate[] = [];
  for (const t of triggers) {
    for (const r of expectedReaction(db, t, { regime })) {
      if (r.strength < minStrength) continue;
      const actual = actualResolver(r.symbol, r.etaDays);
      if (actual === null) continue;
      const res = residualOf(r.direction, r.strength, actual, residualOpts);
      if (res.isAnomaly) {
        out.push({ trigger: t, node: r.node, symbol: r.symbol, direction: r.direction, strength: r.strength, expectedPct: res.expectedPct, actualPct: actual, residual: res.residual });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
}

/** 이상치 후보 → dig_queue 적재(대표 게이트·명시 호출만). 반환 = 적재 수. */
export function enqueueAnomalyDigs(digDb: Database, cands: AnomalyCandidate[], now: string): number {
  if (!cands.length) return 0;
  ensureDigTables(digDb);
  let n = 0;
  for (const c of cands) {
    const id = `kganom-${c.symbol}-${now.slice(0, 10)}`;
    const topic = `예측 이탈: ${c.symbol} (예상 ${c.direction > 0 ? '+' : '-'}${(c.strength * 100).toFixed(0)}%·실측 ${c.actualPct}%·트리거 ${c.trigger})`;
    digDb.run(
      `INSERT INTO dig_queue(id, topic, sector, score, created_at, status) VALUES(?,?,?,?,?,'queued')
       ON CONFLICT(id) DO NOTHING`,
      [id, topic, '', Math.round(Math.abs(c.residual) * 10), now],
    );
    n++;
  }
  return n;
}
