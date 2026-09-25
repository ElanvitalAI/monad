#!/usr/bin/env bun
// 온톨로지 빌드 실행 스크립트(배치·새벽 크론 후보). seed + 상관 측정 → knowledge.db.
// READ(screener/us_pulse 가격) WRITE(knowledge.db kg only·매매 격리). LLM 미사용.
//
// 사용: bun scripts/kg-ontology-build.ts [--regime RISK_ON] [--from 2026-04-01] [--json]

import { buildOntology } from '../src/domains/kg-build.js';
import { openKgDb, listNodes, getEdges } from '../src/domains/kg-store.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const now = new Date().toISOString();
const regime = arg('regime', 'RISK_ON');
const fromDate = arg('from');
const jsonOut = process.argv.includes('--json');

const db = openKgDb();
const result = buildOntology(now, { db, regime, fromDate, minAbsCorr: 0.2 });

if (jsonOut) {
  console.log(JSON.stringify(result));
} else {
  console.log('=== 온톨로지 빌드 완료 ===');
  console.log(`seed: chains=${result.seed.chains} subchains=${result.seed.subchains} companies=${result.seed.companies} US=${result.seed.usCompanies} groups=${result.seed.groups}`);
  console.log(`밸류체인 supplies=${result.seed.supplies} · belongs_to=${result.seed.belongsTo}`);
  console.log(`상관 측정: 크로스마켓=${result.correlate.crossMarket} 그룹=${result.correlate.groups}`);
  console.log(`그래프 총계: nodes=${result.stats.nodes} edges=${result.stats.edges} active=${result.stats.activeEdges}`);
  const corr = getEdges(db, { relation: 'correlates', activeOnly: true });
  if (corr.length) {
    console.log('\n측정된 상관(correlates):');
    for (const e of corr) console.log(`  ${e.src} → ${e.dst}: ${e.weight} (lag ${e.leadLag ?? 0}, ${e.regimeAt ?? '무국면'})`);
  }
  console.log(`\n체인: ${listNodes(db, { kind: 'chain' }).map(n => n.name).join(', ')}`);
}
db.close();
