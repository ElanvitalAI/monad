// ── 미니 백테스트 시뮬레이터 (B5 · backtest-sim · 2026-07-08) ─────────────
//
// 가설(전략+유니버스)의 일수익률 시계열을 받아 정직한 3단계(M-1/2/3) + 학술
// 게이트(CPCV·DSR·PBO·WRC) 를 계산해 ExperimentResult 로 조립. backtest-cycle 의
// runBacktest 실체. B0 순수 메트릭 재사용 · deps.loadDailyReturns 주입(가격 소스).
//
// ⚠️ 간이 시뮬(equal-weight 포트폴리오 baseline). 전략별 정교화(vol scaling·
// z-sizing)는 후속 — 지금은 메트릭 파이프라인 확립이 목적. 매매 격리(페이퍼).
// [[PLAN-quant-backtest-retro-loops-2026-07-08]] §3.1 · [[ROADMAP-...]] B5.

import type { ExperimentResult, PortfolioExperiment } from './backtest-store.js';
import type { PortfolioHypothesis } from './backtest-hypothesis.js';
import {
  annualizedSharpe, deflatedSharpe, cpcvPositive, probabilityBacktestOverfit,
  whiteRealityCheck, walkForwardSummary, mean, std,
} from './backtest-metrics.js';
import { evaluateGate } from './backtest-gate.js';
import { strategyReturns } from './backtest-strategy.js';

const COST_BPS_PER_TURN = 5;   // 슬리피지+수수료 근사(size-based 3~7bps 중간)

/** 누적 수익률(복리). */
export function cumReturn(dailyReturns: number[]): number {
  return dailyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}
/** 최대 낙폭(음수). */
export function maxDrawdown(dailyReturns: number[]): number {
  let peak = 1, cur = 1, mdd = 0;
  for (const r of dailyReturns) { cur *= 1 + r; peak = Math.max(peak, cur); mdd = Math.min(mdd, cur / peak - 1); }
  return mdd;
}
/** equal-weight 포트폴리오 일수익률 — 각 날 유니버스 평균. */
export function portfolioReturns(returnsBySymbol: Map<string, number[]>, universe: string[]): number[] {
  const series = universe.map(s => returnsBySymbol.get(s)).filter((x): x is number[] => Array.isArray(x) && x.length > 0);
  if (!series.length) return [];
  const len = Math.min(...series.map(s => s.length));
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(mean(series.map(s => s[s.length - len + i]!)));
  return out;
}

export interface SimDeps {
  /** 유니버스 심볼별 일수익률(과거·최신 뒤). 부족 시 심볼 생략. */
  loadDailyReturns: (symbols: string[]) => Map<string, number[]>;
  /** 그날 생성된 가설 수(다중검정 보정·DSR nTrials). */
  trialsToday?: number;
  /** 국면(external_regime_adaptive 전략 적응·기본 NEUTRAL). */
  regime?: string;
  now?: () => string;
}

const MIN_DAYS = 60;   // 최소 관측(2~3개월)

/** 미니 백테스트 1건 — 가격 시계열→M-1/2/3+게이트→ExperimentResult. 데이터 부족 시 null. */
export function runMiniBacktest(h: PortfolioHypothesis, exp: PortfolioExperiment, deps: SimDeps): ExperimentResult | null {
  const returnsBySymbol = deps.loadDailyReturns(h.universe);
  // 전략별 가중(vol scaling·모멘텀 게이팅·국면 적응). equal-weight baseline 대체.
  const port = strategyReturns(returnsBySymbol, h.universe, h.strategy, deps.regime ?? 'NEUTRAL');
  if (port.length < MIN_DAYS) return null;

  // M-1 Full
  const sharpe = annualizedSharpe(port);
  const roi = cumReturn(port);
  const mdd = maxDrawdown(port);
  const calmar = mdd < 0 ? (roi) / Math.abs(mdd) : 0;
  const trades = Math.max(1, Math.round(port.length / 20));  // 근사(월 1회 리밸런싱)

  // M-2 Robustness — 3 서브윈도우(균등 분할) 양수 일관성.
  const third = Math.floor(port.length / 3);
  const subs = [port.slice(0, third), port.slice(third, 2 * third), port.slice(2 * third)];
  const subSharpes = subs.map(annualizedSharpe);
  const subwindowPositive = subs.filter(s => cumReturn(s) > 0).length;
  const consistency = mean(subSharpes) / (1 + std(subSharpes));

  // M-3 Walk-forward — 겹치지 않는 세그먼트(63일=분기).
  const segLen = 63;
  const segments: Array<{ dailyReturns: number[] }> = [];
  for (let i = 0; i + segLen <= port.length; i += segLen) segments.push({ dailyReturns: port.slice(i, i + segLen) });
  const wf = walkForwardSummary(segments.length ? segments : [{ dailyReturns: port }]);

  // CPCV — fold별 Sharpe(간이: 세그먼트 Sharpe 를 path 로).
  const pathSharpes = segments.map(s => annualizedSharpe(s.dailyReturns));
  const cpcv = cpcvPositive(pathSharpes.length ? pathSharpes : [sharpe]);

  // PBO — IS(앞 절반)/OOS(뒤 절반) 세그먼트 짝.
  const half = Math.floor(segments.length / 2);
  const pairs = segments.slice(0, half).map((s, i) => ({
    is: annualizedSharpe(s.dailyReturns),
    oos: annualizedSharpe(segments[half + i]?.dailyReturns ?? []),
  })).filter(p => Number.isFinite(p.oos));
  const pbo = pairs.length >= 2 ? probabilityBacktestOverfit(pairs) : (sharpe > 0 ? 0.5 : 1);

  // DSR / WRC / Pre-Bull
  const dsr = deflatedSharpe(port, deps.trialsToday ?? 1);
  const wrc = whiteRealityCheck(port, { seed: 20260708 });
  // Pre-Bull 강화(2026-07-08 · 강세 의존 배제): 첫 2/3 구간 양수 AND 최악 63일
  // 세그먼트 손실 -15% 이내. 강세장 전체가 우상향이어도 큰 낙폭 구간이 있으면 배제.
  const worstSeg = segments.length ? Math.min(...segments.map(s => cumReturn(s.dailyReturns))) : cumReturn(port);
  const prebullRobust = cumReturn(port.slice(0, Math.floor(port.length * 2 / 3))) > 0 && worstSeg > -0.15;

  // 슬리피지 반영
  const slippageBps = COST_BPS_PER_TURN * trades / (port.length / 252 || 1);  // 연 회전 비용 근사
  const costDrag = (COST_BPS_PER_TURN / 10_000) * trades;
  const costAdjustedSharpe = annualizedSharpe(port.map((r, i) => i === 0 ? r - costDrag / port.length : r - costDrag / port.length));

  const partial: ExperimentResult = {
    expId: exp.id, ts: deps.now?.() ?? new Date().toISOString(),
    roi, sharpe, mdd, calmar, trades,
    consistency, subwindowPositive,
    wfWinRate: wf.winRate, wfMeanSharpe: wf.meanSharpe,
    cpcvPaths: cpcv.paths, cpcvMeanSharpe: cpcv.meanSharpe, cpcvPositivePct: cpcv.positivePct,
    dsr, pbo, wrcPass: wrc.pass, prebullRobust,
    slippageBps, costAdjustedSharpe,
    verdict: 'INCONCLUSIVE',   // evaluateGate 로 확정
    gateDetail: { wrcPValue: wrc.pValue, subSharpes },
  };
  partial.verdict = evaluateGate(partial).verdict;
  return partial;
}
