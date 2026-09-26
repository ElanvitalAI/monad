// ── 백테스팅 학술 메트릭 (B0 · backtest-metrics · 2026-07-08) ─────────────
//
// 과최적화 차단 통계(López de Prado AFML 계승·순수 함수). factor-backtest 스킬은
// git 미관리라 elanous TS 로 구현 — 버전관리·단위테스트·B5 직접 호출(subprocess 0).
//  - annualizedSharpe: 일수익률 → 연율 Sharpe(√252)
//  - deflatedSharpe(DSR): 다중검정 보정 — nTrials(그날 가설 수) 반영
//  - probabilisticSharpe(PSR): SR>기준 확률(skew/kurt 보정)
//  - cpcvPositive: CPCV path별 Sharpe 양수 비율
//  - probabilityBacktestOverfit(PBO): OOS 붕괴 확률(CPCV IS/OOS 순위·근사)
//  - whiteRealityCheck(WRC): block bootstrap p-value(data-snooping)
//  - decileReturns: score 십분위 forward 수익률(monotonicity)
//  - walkForward: 세그먼트별 win rate·mean Sharpe(정직한 M-3)
//
// ⚠️ 표준 근사 — 정밀 CSCV/DSR 대비 실용 버전(게이트 작동 목적). rng 주입(seed·
// harness Math.random 금지). [[RESEARCH-quant-backtest-retro-loops-2026-07-08]] §2.2.

const SQRT252 = Math.sqrt(252);
const EULER = 0.5772156649015329;

// ── 정규분포 헬퍼(Abramowitz-Stegun 근사·순수) ──

/** 표준정규 CDF. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** 표준정규 역함수(Acklam 근사). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

// ── 기본 통계 ──

export function mean(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function skewness(xs: number[]): number {
  const m = mean(xs), s = std(xs); if (s === 0 || xs.length < 3) return 0;
  return xs.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / xs.length;
}
function kurtosis(xs: number[]): number {
  const m = mean(xs), s = std(xs); if (s === 0 || xs.length < 4) return 3;
  return xs.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / xs.length;
}

/** 연율 Sharpe(일수익률 배열). */
export function annualizedSharpe(dailyReturns: number[]): number {
  const s = std(dailyReturns);
  return s === 0 ? 0 : (mean(dailyReturns) / s) * SQRT252;
}

// ── seed rng(harness Math.random 금지) ──
/** 결정론 LCG — 테스트·bootstrap 재현. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── 학술 메트릭 ──

/** PSR — Sharpe가 기준(srBenchmark)을 초과할 확률(skew/kurt 보정·연율 SR 입력). */
export function probabilisticSharpe(sr: number, srBenchmark: number, n: number, skew: number, kurt: number): number {
  if (n < 2) return 0.5;
  const denom = Math.sqrt(Math.max(1e-9, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return normCdf((sr - srBenchmark) * Math.sqrt(n - 1) / denom);
}

/** DSR — 다중검정(nTrials) 보정된 Sharpe 확률. sr* = N개 시도의 기대 최대 Sharpe.
 *  daily returns + 시도 수. sr>0 유의성을 nTrials 로 할인. */
export function deflatedSharpe(dailyReturns: number[], nTrials: number): number {
  const n = dailyReturns.length;
  if (n < 4) return 0;
  const srDaily = mean(dailyReturns) / (std(dailyReturns) || 1e-9);
  const sr = srDaily * SQRT252;
  const varSr = (1 - skewness(dailyReturns) * srDaily + ((kurtosis(dailyReturns) - 1) / 4) * srDaily * srDaily) / (n - 1);
  const sdSr = Math.sqrt(Math.max(1e-12, varSr)) * SQRT252;
  const N = Math.max(1, nTrials);
  const srStar = N <= 1 ? 0 : sdSr * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
  return probabilisticSharpe(sr, srStar, n, skewness(dailyReturns), kurtosis(dailyReturns));
}

/** CPCV positive — path별 Sharpe 양수 비율. path Sharpes 입력. */
export function cpcvPositive(pathSharpes: number[]): { paths: number; meanSharpe: number; positivePct: number } {
  if (!pathSharpes.length) return { paths: 0, meanSharpe: 0, positivePct: 0 };
  const pos = pathSharpes.filter(s => s > 0).length;
  return { paths: pathSharpes.length, meanSharpe: mean(pathSharpes), positivePct: pos / pathSharpes.length };
}

/** PBO(근사) — CPCV IS/OOS 순위 붕괴 확률. IS 최고 설정이 OOS median 아래로 떨어진 비율.
 *  pairs: 각 split의 (isSharpe, oosSharpe). 정밀 CSCV 대비 logit 근사. */
export function probabilityBacktestOverfit(pairs: Array<{ is: number; oos: number }>): number {
  if (pairs.length < 2) return 1;
  // 근사: IS 에서 양(+)의 성과였던 split 이 OOS 에서 수익을 못 낸(≤0) 비율.
  // IS 강세가 OOS 로 이어지지 않을수록 과적합 확률↑ (정밀 CSCV logit 대체).
  const isPositive = pairs.filter(p => p.is > 0);
  if (!isPositive.length) return 1;   // IS 조차 없으면 무의미
  const collapsed = isPositive.filter(p => p.oos <= 0).length;
  return collapsed / isPositive.length;
}

/** WRC(근사) — block bootstrap 으로 평균 수익률>0 유의성(data-snooping 보정). */
export function whiteRealityCheck(dailyReturns: number[], opts: { nPerm?: number; block?: number; seed?: number } = {}): { pValue: number; pass: boolean } {
  const n = dailyReturns.length;
  if (n < 10) return { pValue: 1, pass: false };
  const nPerm = opts.nPerm ?? 1000, block = opts.block ?? 5;
  const rng = makeRng(opts.seed ?? 12345);
  const observed = mean(dailyReturns);
  const centered = dailyReturns.map(r => r - observed);   // H0: 평균 0
  let ge = 0;
  for (let p = 0; p < nPerm; p++) {
    const sample: number[] = [];
    while (sample.length < n) {
      const start = Math.floor(rng() * n);
      for (let b = 0; b < block && sample.length < n; b++) sample.push(centered[(start + b) % n]!);
    }
    if (mean(sample) >= observed) ge++;
  }
  const pValue = ge / nPerm;
  return { pValue, pass: pValue < 0.05 };
}

/** Decile returns — score 십분위별 forward 수익률(monotonic 이면 신호 유효). */
export function decileReturns(pairs: Array<{ score: number; fwdReturn: number }>): Array<{ decile: number; n: number; meanReturn: number }> {
  if (pairs.length < 10) return [];
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const per = Math.floor(sorted.length / 10);
  const out: Array<{ decile: number; n: number; meanReturn: number }> = [];
  for (let d = 0; d < 10; d++) {
    const slice = sorted.slice(d * per, d === 9 ? sorted.length : (d + 1) * per);
    out.push({ decile: d + 1, n: slice.length, meanReturn: mean(slice.map(x => x.fwdReturn)) });
  }
  return out;
}

/** Walk-forward 집계 — 세그먼트별 OOS 수익률 → win rate·mean Sharpe(정직한 M-3). */
export function walkForwardSummary(segments: Array<{ dailyReturns: number[] }>): { windows: number; winRate: number; meanSharpe: number } {
  const valid = segments.filter(s => s.dailyReturns.length >= 2);
  if (!valid.length) return { windows: 0, winRate: 0, meanSharpe: 0 };
  const sharpes = valid.map(s => annualizedSharpe(s.dailyReturns));
  const wins = valid.filter(s => s.dailyReturns.reduce((a, x) => a + x, 0) > 0).length;
  return { windows: valid.length, winRate: wins / valid.length, meanSharpe: mean(sharpes) };
}
