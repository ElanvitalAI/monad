#!/usr/bin/env bun
// 온톨로지 탐색(READ-ONLY). 대표 즉시 사용(데몬 불필요).
//
// 사용:
//   bun scripts/kg-query.ts stats
//   bun scripts/kg-query.ts cluster chain:반도체
//   bun scripts/kg-query.ts blast policy:us-export-control [--regime RISK_ON]
//   bun scripts/kg-query.ts recall "반도체 전망"
//   bun scripts/kg-query.ts corr          # 측정된 상관 목록
//   bun scripts/kg-query.ts cross          # 한미 크로스마켓

import { openKgDb, listNodes, getEdges, kgStats, getNode } from '../src/domains/kg-store.js';
import { recallCluster, recallHybrid } from '../src/domains/kg-recall.js';
import { blastRadius } from '../src/domains/kg-infer.js';
import { backtestLeadLagEdges } from '../src/domains/kg-backtest.js';

const [cmd, arg] = process.argv.slice(2);
const regimeIdx = process.argv.indexOf('--regime');
const regime = regimeIdx >= 0 ? process.argv[regimeIdx + 1] : undefined;
const db = openKgDb();
const nm = (id: string): string => getNode(db, id)?.name ?? id;

switch (cmd) {
  case 'stats': {
    const s = kgStats(db);
    console.log(`nodes=${s.nodes} edges=${s.edges} active=${s.activeEdges}`);
    for (const k of ['chain', 'subchain', 'company', 'group', 'theme', 'policy', 'event'] as const) {
      console.log(`  ${k}: ${listNodes(db, { kind: k }).length}`);
    }
    break;
  }
  case 'cluster': {
    const c = recallCluster(db, arg!);
    if (!c) { console.log('없음:', arg); break; }
    console.log(`클러스터 ${c.name} (${c.id})`);
    console.log(`  서브: ${c.subclusters.map(nm).join(', ')}`);
    console.log(`  종목(${c.members.length}): ${c.members.map(nm).join(', ')}`);
    break;
  }
  case 'blast': {
    const hits = blastRadius(db, arg!, { regime });
    console.log(`영향 범위: ${nm(arg!)} ${regime ? `(${regime})` : ''}`);
    for (const h of hits) console.log(`  ${h.weight > 0 ? '▲' : '▼'} ${nm(h.node)} weight=${h.weight} hop=${h.hop} eta=${h.lag}일`);
    break;
  }
  case 'recall': {
    const r = recallHybrid(db, { query: arg, regime, bump: false });
    console.log(`회상: "${arg}"`);
    console.log(`  진입: ${r.seeds.map(nm).join(', ')}`);
    for (const c of r.clusters) console.log(`  클러스터 ${c.name}: 종목 ${c.members.length}·서브 ${c.subclusters.length}`);
    if (r.causal.length) console.log(`  인과: ${r.causal.slice(0, 8).map(h => `${nm(h.node)}(${h.weight})`).join(', ')}`);
    break;
  }
  case 'corr': {
    const es = getEdges(db, { relation: 'correlates', activeOnly: true });
    console.log(`측정된 상관 ${es.length}:`);
    for (const e of es) console.log(`  ${nm(e.src)} → ${nm(e.dst)}: ${e.weight} (lag ${e.leadLag ?? 0}, ${e.regimeAt ?? '무국면'})`);
    break;
  }
  case 'cross': {
    const es = getEdges(db, { relation: 'cross_market', activeOnly: true });
    console.log(`한미 크로스마켓 ${es.length}:`);
    for (const e of es) console.log(`  ${nm(e.src)} → ${nm(e.dst)}`);
    break;
  }
  case 'backtest': {
    const s = backtestLeadLagEdges(db, { minN: 8 });
    console.log(`예측 백테스트: 검증 ${s.tested}엣지 · 평균 hitRate=${s.avgHitRate} · IC=${s.avgIc} · 강한(>=0.6)=${s.strong}`);
    console.log('(주의: in-sample·표본 작음·낙관적. 일일 축적으로 out-of-sample 검증.)');
    for (const e of s.edges.slice(0, 12)) console.log(`  ${nm(e.src)}→${nm(e.dst)} lag=${e.leadLag}: hit=${e.hitRate} IC=${e.ic?.toFixed(2)} (n=${e.n})`);
    break;
  }
  default:
    console.log('명령: stats | cluster <id> | blast <id> [--regime R] | recall "<text>" | corr | cross | backtest');
}
db.close();
