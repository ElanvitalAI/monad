// ── finviz S&P 히트맵 데이터 티어 (2026-07-08 · A1) ──────────────────────
//
// 대표 요구: 아침 브리핑에 S&P 히트맵. Finviz Elite 불필요 — 무료 공개 API
// (map_perf.ashx?t=sec) 가 S&P 500 전종목 성과%를 준다. 이걸 breadth + 톱/워스트
// 무버로 요약(텍스트 gestalt). 이미지+비전 티어는 별도(A2·firecrawl 스크린샷).
//
// ★ 외부 커뮤니티 표준 패턴(검증): 맵 .ashx → 요약/vision → 일일 브리핑.
// ★ Referer 헤더 필수(finviz 안티스크래핑). fail-soft — 실패 시 섹션 생략.
//
// 순수(요약·포맷) + 주입 fetcher(테스트 결정론). 근거: BACKLOG-conatus §A(대표 지시).

export interface FinvizMapSummary {
  total: number;
  up: number;
  down: number;
  avgPct: number;
  top: Array<{ ticker: string; perf: number }>;    // 상위 상승
  bottom: Array<{ ticker: string; perf: number }>; // 상위 하락
}

/** {ticker: perf%} → breadth + 톱/워스트 무버(순수). 빈 입력 = null. */
export function summarizeFinvizMap(nodes: Record<string, number>, topN = 3): FinvizMapSummary | null {
  const entries = Object.entries(nodes ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  const up = entries.filter(([, v]) => v > 0).length;
  const avg = entries.reduce((s, [, v]) => s + v, 0) / entries.length;
  const asMover = ([ticker, perf]: [string, number]) => ({ ticker, perf });
  return {
    total: entries.length, up, down: entries.length - up, avgPct: avg,
    top: sorted.slice(-topN).reverse().map(asMover),
    bottom: sorted.slice(0, topN).map(asMover),
  };
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

/** 요약 → 브리핑 섹션 텍스트. */
export function formatFinvizMap(s: FinvizMapSummary): string {
  const arrow = s.avgPct > 0.05 ? '▲' : s.avgPct < -0.05 ? '▼' : '·';
  const mv = (m: { ticker: string; perf: number }) => `${m.ticker} ${pct(m.perf)}`;
  return `\n🗺️ *S&P 히트맵* (${s.total}종)`
    + `\n  breadth ${s.up}↑/${s.down}↓ · 평균 ${arrow}${pct(s.avgPct)}`
    + `\n  강세 ${s.top.map(mv).join(' · ')} / 약세 ${s.bottom.map(mv).join(' · ')}`;
}

const FINVIZ_MAP_URL = 'https://finviz.com/api/map_perf.ashx?t=sec';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/** map_perf.ashx → {ticker: perf}. Referer 필수. fail-soft null. */
export async function fetchFinvizMapNodes(
  fetcher: () => Promise<Record<string, number> | null> = defaultFetch,
): Promise<Record<string, number> | null> {
  try { return await fetcher(); } catch { return null; }
}

async function defaultFetch(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(FINVIZ_MAP_URL, {
      headers: { 'User-Agent': UA, Referer: 'https://finviz.com/map.ashx?t=sec', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = await res.json() as { nodes?: Record<string, number> };
    return j && typeof j.nodes === 'object' ? j.nodes : null;
  } catch { return null; }
}

/** 조립+포맷 원샷(morning-report 편의). 실패/빈값 = '' (섹션 생략). */
export async function renderFinvizMap(
  fetcher?: () => Promise<Record<string, number> | null>,
): Promise<string> {
  const nodes = await fetchFinvizMapNodes(fetcher ?? defaultFetch);
  if (!nodes) return '';
  const s = summarizeFinvizMap(nodes);
  return s ? formatFinvizMap(s) : '';
}
