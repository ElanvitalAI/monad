// ── 온톨로지 hybrid retrieval (M5 P8 · 전체 통합 · 2026-07-08) ────────────
//
// 벡터 회상 위에 그래프 확장을 얹음(RFC §7). 기존 벡터 회상 불변·확장만.
//  - linkEntities: 텍스트 → kg_nodes(aliases/name deterministic 매칭).
//  - recallCluster: 체인/그룹 서브그래프(멤버·서브체인·종목·R1).
//  - recallHybrid: (벡터 진입 주입) → 엔티티 링킹 → cluster + blastRadius 확장.
// 회상된 노드 recall_count++ (미엘린 M4.1). READ-ONLY(회상 외 쓰기 없음).

import { Database } from 'bun:sqlite';
import { getEdges, listNodes, bumpRecall, getNode, type KgNode } from './kg-store.js';
import { blastRadius, type BlastHit } from './kg-infer.js';

/** ASCII 별칭은 단어경계(티커 MU 오탐 방지), 그 외(한글명)는 substring 매칭. */
function aliasHit(text: string, alias: string): boolean {
  if (alias.length < 2) return false;
  if (/^[A-Za-z0-9.]+$/.test(alias)) {
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`).test(text);
  }
  return text.includes(alias);
}

/** 텍스트 → 매칭 노드 id(deterministic). name(len>=2) substring + aliases 경계매칭. */
export function linkEntities(db: Database, text: string): string[] {
  if (!text) return [];
  const nodes = listNodes(db);
  const out: string[] = [];
  for (const n of nodes) {
    if (n.name.length >= 2 && text.includes(n.name)) { out.push(n.id); continue; }
    if (n.aliases?.some(a => aliasHit(text, a))) out.push(n.id);
  }
  return [...new Set(out)];
}

export interface Cluster { id: string; name: string; members: string[]; subclusters: string[] }

/** 체인/그룹 서브그래프(R1) — belongs_to 역방향(누가 이 클러스터에 속하나) BFS. */
export function recallCluster(db: Database, clusterId: string, opts: { maxDepth?: number } = {}): Cluster | null {
  const node = getNode(db, clusterId);
  if (!node) return null;
  const { maxDepth = 2 } = opts;
  const members = new Set<string>();
  const subclusters = new Set<string>();
  let frontier = [clusterId];
  const seen = new Set<string>([clusterId]);
  for (let d = 0; d < maxDepth; d++) {
    const next: string[] = [];
    for (const c of frontier) {
      for (const e of getEdges(db, { dst: c, relation: 'belongs_to', activeOnly: true })) {
        if (seen.has(e.src)) continue;
        seen.add(e.src);
        if (e.src.startsWith('subchain:') || e.src.startsWith('chain:') || e.src.startsWith('group:')) {
          subclusters.add(e.src); next.push(e.src);
        } else members.add(e.src);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return { id: clusterId, name: node.name, members: [...members], subclusters: [...subclusters] };
}

export interface HybridRecall {
  seeds: string[];            // 링킹된 진입 노드
  clusters: Cluster[];        // 체인/그룹 확장
  causal: BlastHit[];         // blastRadius 인과 확장
  nodes: KgNode[];            // 관련 노드 상세
}

export interface HybridOpts {
  query?: string;             // 질의 텍스트(엔티티 링킹)
  vectorHits?: string[];      // 벡터 회상이 준 노드 id(주입 seam)
  regime?: string;            // 국면(blast 매칭)
  maxHop?: number;
  bump?: boolean;             // recall_count++ (기본 true)
}

/** hybrid retrieval — 링킹/벡터 진입 → cluster + blastRadius 확장. 회상 노드 recall++. */
export function recallHybrid(db: Database, opts: HybridOpts = {}): HybridRecall {
  const linked = opts.query ? linkEntities(db, opts.query) : [];
  const seeds = [...new Set([...linked, ...(opts.vectorHits ?? [])])];
  const clusters: Cluster[] = [];
  const causal: BlastHit[] = [];
  for (const s of seeds) {
    if (s.startsWith('chain:') || s.startsWith('group:')) {
      const c = recallCluster(db, s); if (c) clusters.push(c);
    }
    causal.push(...blastRadius(db, s, { regime: opts.regime, maxHop: opts.maxHop ?? 2 }));
  }
  const relatedIds = [...new Set([...seeds, ...clusters.flatMap(c => [...c.members, ...c.subclusters]), ...causal.map(h => h.node)])];
  if (opts.bump !== false) bumpRecall(db, relatedIds);
  const nodes = relatedIds.map(id => getNode(db, id)).filter((n): n is KgNode => !!n);
  return { seeds, clusters, causal: dedupCausal(causal), nodes };
}

/** blast 중복 노드 제거(|weight| 큰 것 유지). */
function dedupCausal(hits: BlastHit[]): BlastHit[] {
  const best = new Map<string, BlastHit>();
  for (const h of hits) { const p = best.get(h.node); if (!p || Math.abs(h.weight) > Math.abs(p.weight)) best.set(h.node, h); }
  return [...best.values()].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}
