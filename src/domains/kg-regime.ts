// ── 국면 벡터 ↔ 온톨로지 연결 (추천5 · 2026-07-08) ────────────────────────
//
// 국면종합(RegimeVector)이 큰 전환(transition·≥2축 부호전환)을 감지하면, 전환한 축을
// 온톨로지 진입 노드로 매핑 → blastRadius 로 "그 전환이 구조적으로 어디까지 파급되나"
// 자동 분석. 국면 벡터(공유 통화)와 인과그래프를 잇는다. READ-ONLY 판단.

import { Database } from 'bun:sqlite';
import { getNode } from './kg-store.js';
import { blastRadius, type BlastHit } from './kg-infer.js';

/** 축 → 온톨로지 진입 노드(존재하는 것만 필터). 국면 축이 가리키는 구조 영역. */
export const AXIS_TO_NODES: Record<string, string[]> = {
  us_sector: ['group:M7', 'group:P7'],
  us_pulse: ['group:M7', 'group:P7'],
  kr_sector: ['chain:반도체', 'chain:2차전지', 'chain:자동차'],
  kr_pulse: ['chain:반도체', 'chain:2차전지'],
  kr_flow: ['chain:반도체'],
  geopolitics: ['policy:us-export-control'],
};

export interface RegimeTransitionLike { transition: boolean; transitionAxes: string[]; regimeLabel: string }

export interface RegimeOntologyContext {
  axes: string[];
  entryNodes: string[];
  causal: BlastHit[];
}

/** 국면 전환 → 온톨로지 인과 파장. transition=false 면 null(평시 조용). */
export function regimeTransitionContext(db: Database, regime: RegimeTransitionLike): RegimeOntologyContext | null {
  if (!regime.transition) return null;
  const entryNodes = [...new Set(regime.transitionAxes.flatMap(a => AXIS_TO_NODES[a] ?? []))].filter(id => getNode(db, id));
  if (!entryNodes.length) return null;
  const causal = dedup(entryNodes.flatMap(n => blastRadius(db, n, { regime: regime.regimeLabel, maxHop: 2 })));
  return { axes: regime.transitionAxes, entryNodes, causal };
}

/** 전환 컨텍스트 → 알림/아침 렌더. null 또는 빈 파장이면 ''. */
export function renderRegimeTransition(db: Database, ctx: RegimeOntologyContext | null): string {
  if (!ctx || !ctx.causal.length) return '';
  const nm = (id: string): string => getNode(db, id)?.name ?? id.split(':').slice(1).join(':');
  const lines = [`  🔀 국면 전환 인과 파장 (전환축: ${ctx.axes.join('·')})`];
  for (const h of ctx.causal.slice(0, 6)) {
    lines.push(`    ${h.weight > 0 ? '▲' : '▼'} ${nm(h.node)} (${h.weight}·${h.lag}일)`);
  }
  return lines.join('\n');
}

function dedup(hits: BlastHit[]): BlastHit[] {
  const best = new Map<string, BlastHit>();
  for (const h of hits) { const p = best.get(h.node); if (!p || Math.abs(h.weight) > Math.abs(p.weight)) best.set(h.node, h); }
  return [...best.values()].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}
