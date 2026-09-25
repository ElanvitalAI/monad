// ── MarketContext 조립 (B5 · backtest-context · 2026-07-08) ───────────────
//
// 그날 시장 정보(regime·모멘텀·섹터·펄스)를 MarketContext 로 조립하는 순수 함수.
// 실배선(scripts/backtest-cycle.ts)이 deps 를 실제 DB(regime.db·screener.db·
// us_pulse.db)로 주입. 순수 조립 로직만 여기 — 테스트 가능. 12-1m 모멘텀(최근
// 21일 제외·252일 룩백·세미나/Jegadeesh-Titman). [[ROADMAP-...]] B5.

import type { MarketContext } from './backtest-hypothesis.js';
import { cumReturn } from './backtest-sim.js';

const LOOKBACK = 252, SKIP = 21;

/** 가격 바(close) 시계열 → 일수익률(순수). 실배선이 screener/us_pulse 바를 변환. */
export function pricesToReturns(bars: Array<{ close: number }>): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close, cur = bars[i]!.close;
    if (prev > 0 && Number.isFinite(cur)) out.push(cur / prev - 1);
  }
  return out;
}

/** 12-1m 누적 모멘텀(최근 21일 제외·252일 룩백). 데이터 부족 시 null. */
export function momentum121(dailyReturns: number[]): number | null {
  if (dailyReturns.length < SKIP + 20) return null;
  const end = dailyReturns.length - SKIP;
  const start = Math.max(0, end - LOOKBACK);
  return cumReturn(dailyReturns.slice(start, end));
}

export interface ContextDeps {
  /** 현재 국면 라벨(regime.db latest 또는 캡스톤). */
  getRegime: () => string;
  /** 후보 유니버스 심볼별 일수익률(과거→최신). */
  loadReturns: (symbols: string[]) => Map<string, number[]>;
  /** 스캔할 유니버스(KR+US 후보). */
  universe: string[];
  /** 섹터 리더(readSectorScores+KR_CHAINS·실배선 주입·선택). */
  getSectorLeaders?: () => Array<{ sector: string; symbols: string[] }>;
  /** 급등락 종목(detectNotables·실배선 주입·선택). */
  getPulseNotables?: () => string[];
  date: string;
}

/** 그날 정보 → MarketContext(순수 조립). 모멘텀은 12-1m 로 계산. */
export function buildMarketContext(deps: ContextDeps): MarketContext {
  const regime = deps.getRegime();
  const returns = deps.loadReturns(deps.universe);

  // 종목별 12-1m 모멘텀.
  const moms: Array<{ symbol: string; mom: number }> = [];
  for (const sym of deps.universe) {
    const r = returns.get(sym);
    if (!r) continue;
    const m = momentum121(r);
    if (m !== null) moms.push({ symbol: sym, mom: m });
  }

  // momentumTs — 절대 트렌드(양수만 의미 있으나 전체 전달·가설이 필터).
  const momentumTs = moms.map(m => ({ symbol: m.symbol, ret: m.mom }));
  // momentumXs — 모멘텀 내림차순 순위(1=최강).
  const ranked = [...moms].sort((a, b) => b.mom - a.mom);
  const momentumXs = ranked.map((m, i) => ({ symbol: m.symbol, relRank: i + 1 }));

  return {
    date: deps.date,
    regime,
    momentumTs,
    momentumXs,
    sectorLeaders: deps.getSectorLeaders?.() ?? [],
    pulseNotables: deps.getPulseNotables?.() ?? [],
  };
}
