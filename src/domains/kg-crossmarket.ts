// ── 한미 lead-lag 전종목 배치 (추천3 · R3·R6 · 2026-07-08) ────────────────
//
// 대표 요구: "미국장 영향이 한국장 섹터로 뻗어가는 모습"·"마이크론-삼성 시계열".
// US 종목(us_pulse.db) × KR 종목(screener.db) cross-correlation lead-lag 배치 스캔 →
// 강한 페어를 cross_market 토폴로지 + correlates(측정·lead_lag·regime_at) 로 자동 확장.
//
// 룩어헤드 가드·US 선행(lag>=0)만 cross_market(전파 방향). READ-ONLY 판단.

import { Database } from 'bun:sqlite';
import { listNodes, addEdge, getEdges } from './kg-store.js';
import { computeLeadLag, type PriceBar, loadKrPrices, loadUsPrices } from './kg-correlation.js';

const tickerOf = (id: string): string => id.split(':').slice(1).join(':');

export interface CrossBatchOpts {
  now: string;
  regime?: string;
  fromDate?: string;
  window?: number;
  maxLag?: number;
  minAbsCorr?: number;        // 이 이상만 엣지화(기본 0.4·전파 강한 것만)
  maxKr?: number;             // KR 종목 상한(N×M 방지·기본 60)
  requireUsLeads?: boolean;   // cross_market 은 US 선행(lag>=0)만(기본 true)
  usPrices?: Map<string, PriceBar[]>;  // 주입 seam
  krPrices?: Map<string, PriceBar[]>;
}

/** US×KR 전종목 lead-lag 배치. 강한 페어 → cross_market(토폴로지) + correlates(측정). */
export function correlateCrossMarketBatch(db: Database, opts: CrossBatchOpts): { pairs: number; edges: number } {
  const { now, regime, window = 60, maxLag = 5, minAbsCorr = 0.4, maxKr = 60, requireUsLeads = true } = opts;
  const fromDate = opts.fromDate ?? isoDaysBefore(now, 180);
  const usTickers = listNodes(db, { kind: 'company', market: 'US' }).map(n => tickerOf(n.id));
  const krCodes = listNodes(db, { kind: 'company', market: 'KR' }).map(n => tickerOf(n.id)).slice(0, maxKr);
  if (!usTickers.length || !krCodes.length) return { pairs: 0, edges: 0 };
  const usP = opts.usPrices ?? loadUsPrices(usTickers, fromDate);
  const krP = opts.krPrices ?? loadKrPrices(krCodes, fromDate);

  const existingCross = new Set(getEdges(db, { relation: 'cross_market' }).map(e => `${e.src}|${e.dst}`));
  let pairs = 0, edges = 0;
  for (const us of usTickers) {
    const a = usP.get(us); if (!a || a.length < maxLag + 4) continue;   // computeLeadLag 최소 표본
    for (const kr of krCodes) {
      const b = krP.get(kr); if (!b) continue;
      pairs++;
      const ll = computeLeadLag(a, b, maxLag, window);
      if (!ll || Math.abs(ll.corr) < minAbsCorr) continue;
      if (requireUsLeads && ll.lag < 0) continue;   // US 가 KR 을 선행(전파 방향)만
      const src = `company:${us}`, dst = `company:${kr}`;
      // cross_market 토폴로지(새 링크만)
      if (!existingCross.has(`${src}|${dst}`)) {
        addEdge(db, { src, dst, relation: 'cross_market', validAt: '2000-01-01', confidence: 0.5, sourceRef: 'batch:leadlag', extractedBy: 'correlation' });
        existingCross.add(`${src}|${dst}`);
      }
      // correlates 측정(lead_lag·regime_at·temporal)
      addEdge(db, { src, dst, relation: 'correlates', weight: round3(ll.corr), leadLag: ll.lag, confidence: Math.abs(ll.corr), regimeAt: regime, validAt: now, sourceRef: 'batch:leadlag', extractedBy: 'correlation' });
      edges++;
    }
  }
  return { pairs, edges };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function isoDaysBefore(now: string, days: number): string {
  const d = new Date(`${now.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
