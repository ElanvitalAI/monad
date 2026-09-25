// ── 온톨로지 예측 백테스트 (추천1 · 2026-07-08) ──────────────────────────
//
// 엔진 신뢰도 실증: lead-lag 엣지(src가 dst를 lag일 선행)가 실제로 예측력이 있나?
// src 수익률[t] 방향 × weight 부호 → dst 수익률[t+lag] 방향 예측. 과거 hit rate + IC.
// factor-backtest 원칙(룩어헤드 가드: t 시점 정보로 t+lag 예측·미래 누설 없음).
//
// 낮은 hit rate = 그 엣지는 노이즈(SHY 정리 후보). 높으면 예측 신뢰. READ-ONLY.

import { Database } from 'bun:sqlite';
import { getEdges, getNode } from './kg-store.js';
import { logReturns, pearson, alignByDate, type PriceBar, loadKrPrices, loadUsPrices } from './kg-correlation.js';

export interface EdgeBacktest {
  src: string; dst: string; leadLag: number; weightSign: number;
  n: number; hits: number; hitRate: number; ic: number | null;
}

/** 단일 lead-lag 엣지 백테스트(순수) — src 방향×부호가 dst[t+lag] 방향 맞추나. */
export function backtestEdge(
  srcBars: PriceBar[], dstBars: PriceBar[], leadLag: number, weightSign: number,
): { n: number; hits: number; hitRate: number; ic: number | null } {
  const al = alignByDate(srcBars, dstBars);
  const ra = logReturns(al.a), rb = logReturns(al.b);
  const lag = Math.max(0, leadLag);
  let n = 0, hits = 0;
  const predSeries: number[] = [], actSeries: number[] = [];
  for (let t = 0; t + lag < rb.length && t < ra.length; t++) {
    const predDir = weightSign * Math.sign(ra[t]!);
    const actDir = Math.sign(rb[t + lag]!);
    if (predDir !== 0 && actDir !== 0) { n++; if (predDir === actDir) hits++; }
    predSeries.push(weightSign * ra[t]!); actSeries.push(rb[t + lag]!);
  }
  return { n, hits, hitRate: n ? Math.round((hits / n) * 1000) / 1000 : 0, ic: pearson(predSeries, actSeries) };
}

export interface BacktestOpts {
  fromDate?: string;
  minN?: number;              // 최소 표본(기본 8)
  relations?: string[];       // 백테스트 대상(기본 correlates·cross_market batch)
  krPrices?: Map<string, PriceBar[]>;   // 주입 seam
  usPrices?: Map<string, PriceBar[]>;
  now?: string;
}

export interface BacktestSummary {
  edges: EdgeBacktest[];
  tested: number;
  avgHitRate: number;
  avgIc: number;
  strong: number;             // hitRate>=0.6 엣지 수
}

const tickerOf = (id: string): string => id.split(':').slice(1).join(':');
const isKr = (id: string): boolean => /^\d{6}$/.test(tickerOf(id));

/** 측정 lead-lag 엣지 전체 백테스트 → hit rate·IC 집계. 엔진 신뢰도 리포트. */
export function backtestLeadLagEdges(db: Database, opts: BacktestOpts = {}): BacktestSummary {
  const minN = opts.minN ?? 8;
  const now = opts.now ?? new Date().toISOString();
  const fromDate = opts.fromDate ?? isoDaysBefore(now, 180);
  const wantRel = new Set(opts.relations ?? ['correlates']);
  const edges = getEdges(db, { activeOnly: true }).filter(e => wantRel.has(e.relation) && e.weight != null && (e.leadLag ?? 0) >= 0);
  // 종목 노드 페어만(company). 가격 로드.
  const companyEdges = edges.filter(e => getNode(db, e.src)?.kind === 'company' && getNode(db, e.dst)?.kind === 'company');
  const codes = [...new Set(companyEdges.flatMap(e => [e.src, e.dst]))];
  const krCodes = codes.filter(isKr).map(tickerOf), usSyms = codes.filter(c => !isKr(c)).map(tickerOf);
  const krP = opts.krPrices ?? loadKrPrices(krCodes, fromDate);
  const usP = opts.usPrices ?? loadUsPrices(usSyms, fromDate);
  const priceOf = (id: string): PriceBar[] | undefined => (isKr(id) ? krP : usP).get(tickerOf(id));

  const out: EdgeBacktest[] = [];
  for (const e of companyEdges) {
    const a = priceOf(e.src), b = priceOf(e.dst);
    if (!a || !b) continue;
    const ws = Math.sign(e.weight!);
    const bt = backtestEdge(a, b, e.leadLag ?? 0, ws);
    if (bt.n < minN) continue;
    out.push({ src: e.src, dst: e.dst, leadLag: e.leadLag ?? 0, weightSign: ws, ...bt });
  }
  const tested = out.length;
  const avgHitRate = tested ? round3(out.reduce((s, x) => s + x.hitRate, 0) / tested) : 0;
  const ics = out.map(x => x.ic).filter((x): x is number => x !== null);
  const avgIc = ics.length ? round3(ics.reduce((s, x) => s + x, 0) / ics.length) : 0;
  const strong = out.filter(x => x.hitRate >= 0.6).length;
  return { edges: out.sort((a, b) => b.hitRate - a.hitRate), tested, avgHitRate, avgIc, strong };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function isoDaysBefore(now: string, days: number): string {
  const d = new Date(`${now.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
