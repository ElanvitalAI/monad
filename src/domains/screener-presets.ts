// ── finance_screener 프리셋 + 포맷 (2026-07-08 · A3) ──────────────────────
//
// EODHD /screener(omni-market) 래핑용 순수 헬퍼. US 종목 스크리닝을 elanous/텔레그램
// 에서 호출. 프리셋 = 즉시 쓸 수 있는 EODHD 필터 JSON + TS 정렬키(스크리너 CLI 가
// sort 미노출 → 결과를 TS 에서 정렬). 매매는 verify+HITL(스크리닝=관찰).
//
// 근거: BACKLOG-conatus §A(대표 지시·finviz/screener arc).

export interface ScreenerRow {
  code?: string;
  name?: string;
  refund_1d_p?: number;   // 1일 %
  refund_5d_p?: number;   // 5일 %
  sector?: string;
  market_capitalization?: number;
  dividend_yield?: number;
}

export interface ScreenerPreset {
  filters: string;                                  // EODHD 필터 JSON
  sortKey: 'refund_1d_p' | 'refund_5d_p' | 'market_capitalization';
  desc: boolean;
  label: string;
}

const US_LARGE = '["market_capitalization",">",5000000000],["exchange","=","us"]';

/** 프리셋 이름 → 필터+정렬. 미상 = null. */
export function screenerPreset(name: string): ScreenerPreset | null {
  switch (name) {
    case 'us-gainers':
      return { filters: `[${US_LARGE},["refund_1d_p",">",3]]`, sortKey: 'refund_1d_p', desc: true, label: 'US 대형 상승(오늘 +3%↑)' };
    case 'us-losers':
      return { filters: `[${US_LARGE},["refund_1d_p","<",-3]]`, sortKey: 'refund_1d_p', desc: false, label: 'US 대형 하락(오늘 -3%↓)' };
    case 'us-momentum':
      return { filters: `[${US_LARGE},["refund_5d_p",">",5]]`, sortKey: 'refund_5d_p', desc: true, label: 'US 모멘텀(5일 +5%↑)' };
    case 'us-value':
      return { filters: `[${US_LARGE},["dividend_yield",">",0.03],["earnings_share",">",0]]`, sortKey: 'market_capitalization', desc: true, label: 'US 배당가치(배당3%↑·흑자)' };
    default:
      return null;
  }
}

const pct = (x?: number) => (typeof x === 'number' ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}%` : '-');
const capB = (x?: number) => (typeof x === 'number' && x > 0 ? `${(x / 1e9).toFixed(1)}B` : '-');

/** 스크리너 행 → 정렬·상위 N 테이블 텍스트(순수). */
export function formatScreenerRows(
  rows: ScreenerRow[], sortKey: ScreenerPreset['sortKey'], desc: boolean, limit: number, label: string,
): string {
  const valid = rows.filter(r => r && r.code);
  const sorted = [...valid].sort((a, b) => {
    const av = Number(a[sortKey] ?? 0), bv = Number(b[sortKey] ?? 0);
    return desc ? bv - av : av - bv;
  }).slice(0, limit);
  if (!sorted.length) return `[${label}] 매치 없음(필터 조정 필요)`;
  const lines = sorted.map(r => `${(r.code ?? '').padEnd(8)} ${pct(r.refund_1d_p)}/${pct(r.refund_5d_p)}(5d) 시총${capB(r.market_capitalization)} · ${(r.name ?? '').slice(0, 28)} [${r.sector ?? '-'}]`);
  return [`[${label}] 상위 ${sorted.length}`, ...lines].join('\n');
}

/** omni-market screener --json 출력(배너 포함)에서 JSON 배열 추출. 실패=[] . */
export function parseScreenerJson(out: string): ScreenerRow[] {
  const m = /\[\s*\{[\s\S]*\}\s*\]/.exec(out ?? '');
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr as ScreenerRow[] : [];
  } catch { return []; }
}
