#!/usr/bin/env bun
// 온톨로지 새벽 공고화 배치(M4.2 REM 정리). build + extract(게이트) + anomaly(게이트).
// 새벽 크론 후보(미국장 마감~한국장 개장 전 06 KST). READ-ONLY 판단·매매 격리.
//
// 사용: bun scripts/kg-consolidate.ts [--regime RISK_ON] [--json]
//   게이트: config kg.extract.enabled(LLM 인과) · kg.anomalyDig.enabled(자동 dig) 기본 off.
//   강제: --arm-extract · --arm-dig (일회성 실행 arming).

import { consolidateOntology } from '../src/domains/kg-consolidate.js';
import { openRegimeDb, latestRegimeVector } from '../src/domains/regime-store.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1] : undefined;
}

/** 최신 국면 라벨(regime.db) — regime_at 태깅용. 실패 시 UNKNOWN. */
function currentRegime(): string {
  try { const db = openRegimeDb(); try { return latestRegimeVector(db)?.regimeLabel ?? 'UNKNOWN'; } finally { db.close(); } } catch { return 'UNKNOWN'; }
}

const now = new Date().toISOString();
const regime = arg('regime') ?? currentRegime();
const jsonOut = process.argv.includes('--json');
const armExtract = process.argv.includes('--arm-extract') ? true : undefined;
const armDig = process.argv.includes('--arm-dig') ? true : undefined;

const r = await consolidateOntology({ now, regime, extractEnabled: armExtract, armAnomalyDig: armDig });

if (jsonOut) {
  console.log(JSON.stringify({ ...r, anomalies: r.anomalies.length }));
} else {
  console.log('=== 온톨로지 새벽 공고화 완료 ===');
  console.log(`build: nodes=${r.build.nodes} edges=${r.build.edges} active=${r.build.activeEdges}`);
  console.log(`상관: 크로스마켓=${r.correlate.crossMarket} 그룹=${r.correlate.groups}`);
  console.log(`LLM 인과 추출: 처리=${r.extract.processed} 엣지=${r.extract.edges} ${r.extract.processed > 0 ? '(armed)' : '(게이트 off)'}`);
  console.log(`이상치: ${r.anomalies.length}건 · dig 적재=${r.digsEnqueued} ${r.digsEnqueued > 0 ? '(armed)' : '(관측만·자동 dig off 또는 이상치 없음)'}`);
  console.log(`SHY 정리: 무효 삭제=${r.pruned.invalidPruned} 중복관측 정리=${r.pruned.dupPruned}`);
  if (r.anomalies.length) {
    console.log('\n예측 이탈(관측):');
    for (const a of r.anomalies.slice(0, 8)) console.log(`  ${a.symbol}: 예상 ${a.expectedPct}% 실측 ${a.actualPct}% (residual ${a.residual}·트리거 ${a.trigger})`);
  }
}
