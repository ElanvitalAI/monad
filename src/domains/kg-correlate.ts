// ── 상관 → correlates 엣지 배선 (M5 P5 · R6·R8·R2 · 2026-07-08) ───────────
//
// P4 순수 상관계산을 그래프에 배선: 페어의 가격 시계열 → correlates 엣지(측정된 ±
// weight·lead_lag·regime_at·temporal valid_at=now). 구조 seed(토폴로지)와 분리 —
// correlates 가 "현재 측정 강도" 층. 대상: 한미 크로스마켓 페어 + P7/M7 그룹 바스켓.
//
// 국면조건부(R2): regime 인자를 regime_at 로 태깅 → 같은 페어라도 국면별 다른 관측.

import { Database } from 'bun:sqlite';
import { getEdges, addEdge } from './kg-store.js';
import {
  computeCorrelation, computeLeadLag, alignByDate, type PriceBar,
  loadKrPrices, loadUsPrices,
} from './kg-correlation.js';

export interface CorrelateOpts {
  now: string;
  regime?: string;         // 관측 당시 국면(R2) → regime_at
  fromDate?: string;       // 가격 조회 시작(기본 now-180d)
  window?: number;         // 상관 window(기본 60)
  maxLag?: number;         // lead-lag 탐색(기본 5)
  minAbsCorr?: number;     // 이 이상만 엣지화(기본 0.3)
  krPrices?: Map<string, PriceBar[]>;  // 주입 seam(테스트)·미제공 시 loadKrPrices
  usPrices?: Map<string, PriceBar[]>;  // 주입 seam(테스트)·미제공 시 loadUsPrices
}

/** now-days 일 전 날짜(YYYY-MM-DD). 프로덕션 런타임 Date 사용(워크플로 아님). */
function daysBefore(now: string, days: number): string {
  const d = new Date(`${now.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const tickerOf = (nodeId: string): string => nodeId.split(':').slice(1).join(':');

/** 한미 크로스마켓 페어(cross_market 토폴로지) → correlates 엣지(측정 weight·lead_lag). */
export function correlateCrossMarket(db: Database, opts: CorrelateOpts): number {
  const { now, regime, window = 60, maxLag = 5, minAbsCorr = 0.3 } = opts;
  const fromDate = opts.fromDate ?? daysBefore(now, 180);
  const links = getEdges(db, { relation: 'cross_market', activeOnly: true });
  if (!links.length) return 0;
  const usTickers = [...new Set(links.map(l => tickerOf(l.src)))];
  const krCodes = [...new Set(links.map(l => tickerOf(l.dst)))];
  const usP = opts.usPrices ?? loadUsPrices(usTickers, fromDate);
  const krP = opts.krPrices ?? loadKrPrices(krCodes, fromDate);
  let n = 0;
  for (const l of links) {
    const a = usP.get(tickerOf(l.src)), b = krP.get(tickerOf(l.dst));
    if (!a || !b) continue;
    const corr = computeCorrelation(a, b, window);
    if (corr === null || Math.abs(corr) < minAbsCorr) continue;
    const ll = computeLeadLag(a, b, maxLag, window);
    addEdge(db, {
      src: l.src, dst: l.dst, relation: 'correlates',
      weight: round3(corr), leadLag: ll?.lag ?? 0, confidence: Math.abs(corr),
      regimeAt: regime, validAt: now, sourceRef: 'corr:screener+us_pulse', extractedBy: 'correlation',
    });
    n++;
  }
  return n;
}

/** 정규화 바스켓 지수(멤버 공통 date·시작 100·평균). 멤버 부족 시 null. */
export function buildBasketIndex(barsMap: Map<string, PriceBar[]>, symbols: string[]): PriceBar[] | null {
  const series = symbols.map(s => barsMap.get(s)).filter((x): x is PriceBar[] => !!x && x.length > 1);
  if (series.length < 2) return null;
  // 공통 date 교집합
  let common: Set<string> | null = null;
  for (const s of series) {
    const sd = new Set(s.map(b => b.date));
    if (common === null) { common = sd; continue; }
    const next = new Set<string>();
    for (const d of common) if (sd.has(d)) next.add(d);
    common = next;
  }
  const dates = [...(common ?? new Set<string>())].sort();
  if (dates.length < 4) return null;
  // 멤버별 date→close 맵 + 시작 정규화
  const maps = series.map(s => new Map(s.map(b => [b.date, b.close])));
  const bases = maps.map(m => m.get(dates[0]!)!);
  const out: PriceBar[] = [];
  for (const date of dates) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < maps.length; i++) {
      const c = maps[i]!.get(date); const base = bases[i]!;
      if (c !== undefined && base > 0) { sum += (c / base) * 100; cnt++; }
    }
    if (cnt) out.push({ date, close: sum / cnt });
  }
  return out.length >= 4 ? out : null;
}

/** 그룹 바스켓 페어 상관 → 그룹 간 correlates 엣지(R7·R8). P7↔M7 역관계 실측. */
export function correlateGroups(
  db: Database, opts: CorrelateOpts & { pairs?: Array<[string, string]> },
): number {
  const { now, regime, window = 60, maxLag = 5, minAbsCorr = 0.3 } = opts;
  const fromDate = opts.fromDate ?? daysBefore(now, 180);
  const pairs = opts.pairs ?? [['group:P7', 'group:M7']];
  let n = 0;
  for (const [ga, gb] of pairs) {
    const membersA = getEdges(db, { dst: ga, relation: 'belongs_to', activeOnly: true }).map(e => tickerOf(e.src));
    const membersB = getEdges(db, { dst: gb, relation: 'belongs_to', activeOnly: true }).map(e => tickerOf(e.src));
    if (membersA.length < 2 || membersB.length < 2) continue;
    // 그룹 멤버는 US 종목 가정(P7/M7). KR 그룹이면 krPrices 주입으로 확장 가능.
    const pool = opts.usPrices ?? loadUsPrices([...membersA, ...membersB], fromDate);
    const pA = pool, pB = pool;
    const idxA = buildBasketIndex(pA, membersA), idxB = buildBasketIndex(pB, membersB);
    if (!idxA || !idxB) continue;
    const al = alignByDate(idxA, idxB);
    if (al.dates.length < 4) continue;
    const corr = computeCorrelation(idxA, idxB, window);
    if (corr === null || Math.abs(corr) < minAbsCorr) continue;
    const ll = computeLeadLag(idxA, idxB, maxLag, window);
    addEdge(db, {
      src: ga, dst: gb, relation: 'correlates',
      weight: round3(corr), leadLag: ll?.lag ?? 0, confidence: Math.abs(corr),
      regimeAt: regime, validAt: now, sourceRef: 'corr:group-basket', extractedBy: 'correlation',
    });
    n++;
  }
  return n;
}

/** 상관 배선 전체(크로스마켓 + 그룹). 반환 = 적재 엣지 수. */
export function correlateAndStore(db: Database, opts: CorrelateOpts): { crossMarket: number; groups: number } {
  return { crossMarket: correlateCrossMarket(db, opts), groups: correlateGroups(db, opts) };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
