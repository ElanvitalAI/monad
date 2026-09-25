// ── 온톨로지 테마 발굴 (M5 P7 · R7·R1 · 2026-07-08) ───────────────────────
//
// 정량 테마 발굴(deterministic·LLM 0): 대표 요구 = 반도체·로봇에 한정 말고 통상 함께
// 오르내리는 다양한 체인을 발굴(R1) + 특정 시기 역관계 로테이션(R7·P7↔M7).
//  - clusterByCorrelation: 상호 높은 |상관| 종목 그룹 → 후보 동조 클러스터(R1 동적발굴).
//  - detectRotationThemes: 그룹 바스켓 단기 상관 음수 → 역관계 로테이션 후보(R7).
// 발굴 결과 = theme 노드 후보 큐(meta.status='candidate') → 검토 후 승격(자동 반영 X).
// 정성 발굴(뉴스/투자사 내러티브)은 후속 게이트(LLM). 여기선 정량만.

import { Database } from 'bun:sqlite';
import { upsertNode, addEdge, nodeId } from './kg-store.js';
import { computeCorrelation, type PriceBar } from './kg-correlation.js';
import { buildBasketIndex } from './kg-correlate.js';

export interface ClusterOpts { window?: number; threshold?: number; minSize?: number }

/** 상관 클러스터링(R1 동적발굴) — 상호 |corr|>=threshold 종목을 연결성분으로 묶음.
 *  순수(priceMap 주입). 반환 = 후보 클러스터(멤버 배열·크기 desc). */
export function clusterByCorrelation(
  symbols: string[], priceMap: Map<string, PriceBar[]>, opts: ClusterOpts = {},
): string[][] {
  const { window = 60, threshold = 0.6, minSize = 2 } = opts;
  const present = symbols.filter(s => (priceMap.get(s)?.length ?? 0) > 3);
  // union-find
  const parent = new Map<string, string>(present.map(s => [s, s]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const c = computeCorrelation(priceMap.get(present[i]!)!, priceMap.get(present[j]!)!, window);
      if (c !== null && Math.abs(c) >= threshold && c > 0) union(present[i]!, present[j]!);  // 동조(양)만 묶음
    }
  }
  const groups = new Map<string, string[]>();
  for (const s of present) { const r = find(s); (groups.get(r) ?? groups.set(r, []).get(r)!).push(s); }
  return [...groups.values()].filter(g => g.length >= minSize).sort((a, b) => b.length - a.length);
}

export interface RotationTheme { groupA: string; groupB: string; corr: number; window: number; kind: 'rotation' | 'comove' }

/** 로테이션 발굴(R7) — 그룹 바스켓 단기 상관. 음수(<-th)=역관계 로테이션(P7↔M7),
 *  강양수(>th)=동조. 특정 시기 포착 위해 window 짧게(기본 20). priceMap 주입(US 가정). */
export function detectRotationThemes(
  pairs: Array<[string, string]>, memberMap: Map<string, string[]>, priceMap: Map<string, PriceBar[]>,
  opts: { window?: number; threshold?: number } = {},
): RotationTheme[] {
  const { window = 20, threshold = 0.5 } = opts;
  const out: RotationTheme[] = [];
  for (const [ga, gb] of pairs) {
    const ma = memberMap.get(ga) ?? [], mb = memberMap.get(gb) ?? [];
    const ia = buildBasketIndex(priceMap, ma), ib = buildBasketIndex(priceMap, mb);
    if (!ia || !ib) continue;
    const c = computeCorrelation(ia, ib, window);
    if (c === null) continue;
    if (c <= -threshold) out.push({ groupA: ga, groupB: gb, corr: round3(c), window, kind: 'rotation' });
    else if (c >= threshold) out.push({ groupA: ga, groupB: gb, corr: round3(c), window, kind: 'comove' });
  }
  return out;
}

/** 발굴 후보를 theme 노드 후보 큐로 적재(meta.status='candidate'). 자동 승격 안 함. */
export function recordThemeCandidate(
  db: Database, now: string,
  cand: { key: string; name: string; members: string[]; evidence?: Record<string, unknown> },
): string {
  const id = nodeId('theme', cand.key);
  upsertNode(db, {
    id, kind: 'theme', market: 'GLOBAL', name: cand.name,
    meta: { status: 'candidate', ...cand.evidence }, firstSeen: now, lastSeen: now,
  });
  for (const m of cand.members) {
    const memberId = m.includes(':') ? m : nodeId('company', m);
    addEdge(db, { src: memberId, dst: id, relation: 'belongs_to', validAt: now, confidence: 0.4, sourceRef: 'discovery', extractedBy: 'correlation' });
  }
  return id;
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
