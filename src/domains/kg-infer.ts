// ── 온톨로지 추론 — blast radius·예측·이상치 (M5 P6 · R2·R5 · 2026-07-08) ──
//
// 그래프 순회로 영향 범위(R2)·예상 반응(R5)·이상치(예측 이탈) 추론. 순수(DB read-only).
//  - blastRadius: 트리거 노드 → 영향 종목/체인(부호 전파·거리 감쇠·lead_lag 누적·국면매칭).
//  - expectedReaction: blast 를 {종목·방향·강도·etaDays} 예측으로.
//  - residualOf: 예측 vs 실측 → residual·이상치 판정(예측 깨면 디깅 트리거·P9).
//
// ★부호 전파: 음의 엣지(경쟁·역상관)를 지나면 방향 반전(경로 곱). READ-ONLY.

import { Database } from 'bun:sqlite';
import { getEdges, type EdgeRelation } from './kg-store.js';

/** blast 에 쓰는 영향 관계(구조 belongs_to 제외 — 멤버십은 영향 아님). */
export const BLAST_RELATIONS: EdgeRelation[] = ['affects', 'causes', 'cross_market', 'correlates', 'competes_with', 'supplies'];

export interface BlastHit { node: string; weight: number; hop: number; lag: number; path: string[] }

export interface BlastOpts {
  maxHop?: number;        // 기본 2
  regime?: string;        // 국면 매칭(R2) — 해당 국면/무국면 엣지만
  decay?: number;         // hop 당 감쇠(기본 0.6)
  minWeight?: number;     // 누적 |weight| 하한(기본 0.05)
  relations?: EdgeRelation[];
}

/** 엣지의 영향 magnitude(부호 포함). 토폴로지(weight null)는 supplies=+1, 그 외 null=전파안함. */
function edgeWeight(rel: EdgeRelation, weight?: number): number | null {
  if (weight != null) return weight;
  if (rel === 'supplies') return 1;
  return null;  // cross_market/competes_with 토폴로지는 measured correlates 로 전파
}

/** 국면 매칭 — regime 미지정이면 전부, 지정이면 해당 국면 or 무국면(구조) 엣지만. */
function regimeOk(edgeRegime: string | undefined, want?: string): boolean {
  if (!want) return true;
  return !edgeRegime || edgeRegime === want;
}

/** 영향 범위(R2) — 트리거에서 BLAST_RELATIONS 순회. 부호 전파·거리 감쇠·lead_lag 누적.
 *  같은 노드는 |누적 weight| 큰 경로 유지. cycle 가드(visited). */
export function blastRadius(db: Database, start: string, opts: BlastOpts = {}): BlastHit[] {
  const { maxHop = 2, regime, decay = 0.6, minWeight = 0.05 } = opts;
  const relations = new Set(opts.relations ?? BLAST_RELATIONS);
  const best = new Map<string, BlastHit>();
  let frontier: Array<{ node: string; w: number; lag: number; path: string[] }> = [{ node: start, w: 1, lag: 0, path: [start] }];
  const visited = new Set<string>([start]);

  for (let hop = 1; hop <= maxHop; hop++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      const edges = getEdges(db, { src: f.node, activeOnly: true })
        .filter(e => relations.has(e.relation) && regimeOk(e.regimeAt, regime));
      for (const e of edges) {
        const ew = edgeWeight(e.relation, e.weight);
        if (ew === null) continue;
        const w = f.w * ew * Math.pow(decay, hop - 1);
        if (Math.abs(w) < minWeight) continue;
        const lag = f.lag + (e.leadLag ?? 0);
        const prev = best.get(e.dst);
        if (!prev || Math.abs(w) > Math.abs(prev.weight)) {
          best.set(e.dst, { node: e.dst, weight: round3(w), hop, lag, path: [...f.path, e.dst] });
        }
        if (!visited.has(e.dst)) { visited.add(e.dst); next.push({ node: e.dst, w, lag, path: [...f.path, e.dst] }); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return [...best.values()].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export interface Reaction { node: string; symbol: string; direction: -1 | 0 | 1; strength: number; etaDays: number; hop: number }

/** 예상 반응(R5) — 트리거 blast 를 {종목·방향·강도·etaDays} 예측으로. */
export function expectedReaction(db: Database, trigger: string, opts: BlastOpts = {}): Reaction[] {
  return blastRadius(db, trigger, opts).map(h => ({
    node: h.node, symbol: h.node.split(':').slice(1).join(':'),
    direction: (h.weight > 0 ? 1 : h.weight < 0 ? -1 : 0) as -1 | 0 | 1,
    strength: Math.abs(h.weight), etaDays: h.lag, hop: h.hop,
  }));
}

export interface ResidualOpts { scalePct?: number; thresholdPct?: number }

/** 예측 vs 실측 → residual·이상치(R5). expectedMove = dir×strength×scalePct(%).
 *  residual = actualPct - expectedMove. |residual|>threshold = 예측 이탈(디깅 후보·P9). */
export function residualOf(
  direction: -1 | 0 | 1, strength: number, actualPct: number, opts: ResidualOpts = {},
): { expectedPct: number; residual: number; isAnomaly: boolean } {
  const scalePct = opts.scalePct ?? 3;
  const thresholdPct = opts.thresholdPct ?? 3;
  const expectedPct = round3(direction * strength * scalePct);
  const residual = round3(actualPct - expectedPct);
  return { expectedPct, residual, isAnomaly: Math.abs(residual) > thresholdPct };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
