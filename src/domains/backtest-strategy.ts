// ── 전략별 포트폴리오 가중 (전략 정교화 · backtest-strategy · 2026-07-08) ──
//
// backtest-sim 의 equal-weight baseline 을 전략별 target_weight 로 정교화(순수).
// 세미나+학술 계승:
//  - vol scaling(변동성 역가중·risk parity 근사) — 전 전략 공통, momentum crash 완화
//    (Daniel-Moskowitz·volatility targeting → Sharpe↑·DD↓)
//  - momentum_overlay: 최근 추세 음수 종목 게이팅(현금) — 완충
//  - long_only_z_sized: 모멘텀 크기 비례 비중
//  - external_regime_adaptive: 강세=추종(all-in) · 약세=추세 게이팅(방어)
//  - long_only_all_in: 게이팅 없음(vol scaling 만)
// [[RESEARCH-quant-backtest-retro-loops-2026-07-08]] §2.2 · [[ROADMAP-...]] 전략 정교화.

import { std } from './backtest-metrics.js';

export type StrategyKey = 'long_only_all_in' | 'momentum_overlay' | 'long_only_z_sized' | 'external_regime_adaptive';

const MIN_HISTORY = 20;
const MOM_WINDOW = 60;   // 최근 60일 모멘텀(게이팅·sizing)

function isBull(regime: string): boolean {
  return /RISK_ON|BULL|R3|RECOVERY|1X|1_5X|1_75X/i.test(regime);
}
function momentum(returns: number[]): number {
  return returns.slice(-MOM_WINDOW).reduce((a, x) => a + x, 0);
}

/** 전략별 심볼 가중(순수·정적 근사). vol scaling 공통 + 전략별 게이팅/sizing → 정규화. */
export function strategyWeights(
  returnsBySymbol: Map<string, number[]>, universe: string[], strategy: string, regime: string,
): Map<string, number> {
  const active = universe.filter(s => (returnsBySymbol.get(s)?.length ?? 0) >= MIN_HISTORY);
  const raw = new Map<string, number>();
  const bull = isBull(regime);
  for (const s of active) {
    const r = returnsBySymbol.get(s)!;
    const vol = std(r) || 1e-6;
    const mom = momentum(r);
    // 전략별 signal weight.
    let sig: number;
    if (strategy === 'momentum_overlay') sig = mom > 0 ? 1 : 0;
    else if (strategy === 'long_only_z_sized') sig = Math.max(0, mom) * 20;   // 모멘텀 비례(스케일)
    else if (strategy === 'external_regime_adaptive') sig = bull ? 1 : (mom > 0 ? 1 : 0);
    else sig = 1;   // long_only_all_in
    if (sig <= 0) continue;
    raw.set(s, sig / vol);   // vol scaling(역가중)
  }
  const total = [...raw.values()].reduce((a, x) => a + x, 0);
  const out = new Map<string, number>();
  if (total > 0) for (const [s, w] of raw) out.set(s, w / total);
  return out;
}

/** 전략 가중 적용 포트폴리오 일수익률(순수). 가중 없으면 빈 배열(전량 현금). */
export function strategyReturns(
  returnsBySymbol: Map<string, number[]>, universe: string[], strategy: string, regime: string,
): number[] {
  const weights = strategyWeights(returnsBySymbol, universe, strategy, regime);
  const active = [...weights.keys()];
  if (!active.length) return [];
  const len = Math.min(...active.map(s => returnsBySymbol.get(s)!.length));
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    let day = 0;
    for (const s of active) { const r = returnsBySymbol.get(s)!; day += (weights.get(s) ?? 0) * r[r.length - len + i]!; }
    out.push(day);
  }
  return out;
}
