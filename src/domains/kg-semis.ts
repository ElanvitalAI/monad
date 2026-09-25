// ── 반도체 밸류체인 포커스 뷰 (종합 아침 브리핑 · 2026-07-10) ─────────────────
//
// 대표 최대 관심사(한국 반도체)를 아침 브리핑의 1급 섹션으로. knowledge.db 그래프에서
// 반도체 체인 구조(밸류체인 supplies)·미국→한국 전파(lead-lag, dedup)·P7↔M7 로테이션을
// 하나의 구조화 뷰로 뽑는다. read-only. 빈 그래프면 null(fail-soft·리포트 불변).
//
// kg-morning 의 온톨로지 섹션과 달리 여기는 "반도체" 클러스터 멤버로 스코프를 좁히고,
// (src,dst) 중복을 제거한다(구 kg-morning 버그: 같은 쌍이 여러 validAt 으로 반복 출력).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { knowledgeDbPath } from './knowledge.js';
import { openKgDb, getEdges, getNode, nodeId, type KgEdge } from './kg-store.js';
import { recallCluster } from './kg-recall.js';

export interface SemisLeadLag { srcName: string; dstName: string; dir: '동조' | '역행'; weight: number; leadLag: number }
export interface SemisSupply { upName: string; downName: string }
export interface SemisView {
  chainName: string;
  memberCount: number;
  supplies: SemisSupply[];          // 밸류체인 상류→하류(존재 stage)
  propagation: SemisLeadLag[];      // 미국→한국 반도체 전파(dedup·top)
  p7m7?: { weight: number; rel: string };
}

const nameOf = (db: Database, id: string): string => getNode(db, id)?.name ?? id.split(':').slice(1).join(':');

/** (src,dst) 쌍 dedup — |weight| 최대만 유지. 구 kg-morning 중복 출력 버그의 근본 수정. */
export function dedupEdges(edges: KgEdge[]): KgEdge[] {
  const best = new Map<string, KgEdge>();
  for (const e of edges) {
    const key = `${e.src}->${e.dst}`;
    const prev = best.get(key);
    if (!prev || Math.abs(e.weight ?? 0) > Math.abs(prev.weight ?? 0)) best.set(key, e);
  }
  return [...best.values()];
}

/** 반도체 체인 구조·전파를 구조화 뷰로. db 미지정 시 실 knowledge.db. 없거나 체인 부재면 null. */
export function collectSemisView(opts: { db?: Database; topPropagation?: number } = {}): SemisView | null {
  if (!opts.db && !existsSync(knowledgeDbPath())) return null;
  const db = opts.db ?? openKgDb();
  const shouldClose = !opts.db;
  const topN = opts.topPropagation ?? 6;
  try {
    const chainId = nodeId('chain', '반도체');
    if (!getNode(db, chainId)) return null;
    const cluster = recallCluster(db, chainId, { maxDepth: 3 });
    const members = new Set<string>(cluster?.members ?? []);
    if (!members.size) return null;

    // 밸류체인 상류→하류(supplies) — 체인 멤버 내부 엣지만.
    const supplies: SemisSupply[] = dedupEdges(
      getEdges(db, { relation: 'supplies', activeOnly: true }).filter(e => members.has(e.src) && members.has(e.dst)),
    ).slice(0, 8).map(e => ({ upName: nameOf(db, e.src), downName: nameOf(db, e.dst) }));

    // 미국→한국 반도체 전파(lead-lag) — 측정 correlates·반도체 멤버에 닿는 것·dedup.
    const propagation: SemisLeadLag[] = dedupEdges(
      getEdges(db, { relation: 'correlates', activeOnly: true })
        .filter(e => e.sourceRef === 'batch:leadlag' && Math.abs(e.weight ?? 0) >= 0.6)
        .filter(e => members.has(e.dst) || members.has(e.src)),
    )
      .sort((a, b) => Math.abs(b.weight ?? 0) - Math.abs(a.weight ?? 0))
      .slice(0, topN)
      .map(e => ({
        srcName: nameOf(db, e.src), dstName: nameOf(db, e.dst),
        dir: (e.weight ?? 0) > 0 ? '동조' : '역행', weight: e.weight ?? 0, leadLag: e.leadLag ?? 0,
      }));

    // P7(반도체공급)↔M7(빅테크) 로테이션 — 최신 측정 correlates 우선.
    let p7m7: SemisView['p7m7'];
    const edge = getEdges(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', activeOnly: true })
      .sort((a, b) => b.validAt.localeCompare(a.validAt))[0];
    if (edge && edge.weight != null) {
      p7m7 = { weight: edge.weight, rel: edge.weight < 0 ? '역관계(공급 vs 빅테크 로테이션)' : '동조' };
    }

    if (!supplies.length && !propagation.length && !p7m7) return null;
    return { chainName: getNode(db, chainId)?.name ?? '반도체', memberCount: members.size, supplies, propagation, p7m7 };
  } catch { return null; } finally { if (shouldClose) db.close(); }
}

/** 텔레그램 에센셜 — 반도체 전파 top 3 + P7↔M7 한 줄. 없으면 ''. */
export function renderSemisEssential(v: SemisView | null): string {
  if (!v) return '';
  const lines = [`🇰🇷 *반도체 밸류체인* (${v.memberCount}종)`];
  for (const p of v.propagation.slice(0, 3)) {
    lines.push(`  📡 ${p.srcName}→${p.dstName} ${p.dir} ${p.weight}·${p.leadLag}일 선행`);
  }
  if (v.p7m7) lines.push(`  ⚔ P7↔M7: ${v.p7m7.rel} ${v.p7m7.weight}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

/** 상세 리포트(S3) — 밸류체인 구조 + 전파 전체 + P7↔M7. Markdown. 없으면 ''. */
export function renderSemisDetail(v: SemisView | null): string {
  if (!v) return '';
  const lines = [`## 🇰🇷 반도체 밸류체인 (${v.chainName} · ${v.memberCount}종)`];
  if (v.supplies.length) {
    lines.push('', '**밸류체인 흐름 (상류→하류)**', '');
    for (const s of v.supplies) lines.push(`- ${s.upName} → ${s.downName}`);
  }
  if (v.propagation.length) {
    lines.push('', '**미국→한국 전파 (lead-lag)**', '', '| 소스 | 대상 | 방향 | weight | 선행(일) |', '|---|---|---|---|---|');
    for (const p of v.propagation) lines.push(`| ${p.srcName} | ${p.dstName} | ${p.dir} | ${p.weight} | ${p.leadLag} |`);
  }
  if (v.p7m7) lines.push('', `**P7(반도체공급)↔M7(빅테크)**: ${v.p7m7.rel} ${v.p7m7.weight}`);
  return lines.join('\n');
}
