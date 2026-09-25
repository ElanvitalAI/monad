// H6 P1 Bundle 2 · Rolling-average pace forecaster.
//
// Simplified port of CodexBar's `HistoricalUsagePace` / `CodexHistoricalPaceEvaluator`.
// The full CodexBar implementation weights historical weeks by exp
// decay and takes a weighted median of reconstructed curves — that's
// ~350 LOC of numerical reconstruction work and we don't need it for
// the H6 P1 MVP. Here we ship a much smaller model:
//
//   1. Window elapsed fraction = (now - windowStart) / windowDuration.
//   2. Expected usage if steady-state = min(100, elapsedFraction * 100).
//   3. Pace ratio = actualUsedPercent / elapsedPercent (guard zero).
//   4. If paceRatio > 1 AND pace * 100 >= 100 before resetsAt,
//      project `atCurrentPaceReachesLimitAt`.
//   5. `recommendation` = safe/warn/throttle by PLAN §5 D8 thresholds
//      (80% / 95%).
//
// The forecaster deliberately doesn't read the history DB in this
// bundle — the pace comes from the already-mapped RateWindow's
// `usedPercent` over window elapsed time, which is what every brand's
// fetcher already exposes authoritatively. History-based projections
// (rolling 7-day avg tokens/hour) live in a v2 once the adapter-hook
// pipeline feeds structured turns directly (Bundle 3+).

import type { RateWindow, UsagePace, UsageSnapshot } from './types.js';

export type BudgetRecommendation = 'safe' | 'warn' | 'throttle';

export interface ForecastResult {
  readonly windowKind: RateWindow['kind'];
  readonly model?: string;
  readonly elapsedPercent: number;
  readonly usedPercent: number;
  readonly expectedUsedPercent: number;
  readonly daysRemaining: number;
  readonly atCurrentPaceReachesLimitAt: number | null;
  readonly recommendation: BudgetRecommendation;
}

export interface ForecastOpts {
  readonly now?: () => number;
  /** Threshold for `warn` recommendation. Default 80%. */
  readonly warnAt?: number;
  /** Threshold for `throttle` recommendation. Default 95%. */
  readonly throttleAt?: number;
}

const DEFAULT_WARN_AT = 80;
const DEFAULT_THROTTLE_AT = 95;

/** Forecast a single window. Returns `null` when insufficient data
 *  (missing resetsAt or windowMinutes ≤ 0). */
export function forecastWindow(
  win: RateWindow,
  opts: ForecastOpts = {},
): ForecastResult | null {
  if (!win.windowMinutes || win.windowMinutes <= 0) return null;
  if (!win.resetsAt || win.resetsAt <= 0) return null;
  const now = (opts.now ?? Date.now)();
  const durationMs = win.windowMinutes * 60 * 1000;
  const windowStart = win.resetsAt - durationMs;
  const elapsedMs = clamp(now - windowStart, 0, durationMs);
  const elapsedPercent = (elapsedMs / durationMs) * 100;
  const usedPercent = clamp(win.used, 0, 100);

  // Steady-state expected = linear by time. If actual > expected the
  // user is pacing faster than the window allots; below = slower.
  const expectedUsedPercent = clamp(elapsedPercent, 0, 100);

  const warnAt = opts.warnAt ?? DEFAULT_WARN_AT;
  const throttleAt = opts.throttleAt ?? DEFAULT_THROTTLE_AT;
  const recommendation: BudgetRecommendation =
    usedPercent >= throttleAt ? 'throttle'
    : usedPercent >= warnAt ? 'warn'
    : 'safe';

  // Project when usedPercent would hit 100 at the CURRENT pace. Only
  // meaningful when the pace ratio > 0.
  let atCurrentPaceReachesLimitAt: number | null = null;
  if (elapsedPercent > 0 && usedPercent > 0 && usedPercent < 100) {
    const paceRatio = usedPercent / elapsedPercent;
    if (paceRatio > 0) {
      const projectedTotal = paceRatio * 100;
      if (projectedTotal >= 100) {
        const msToFull = (100 / paceRatio) * durationMs / 100;
        atCurrentPaceReachesLimitAt = windowStart + msToFull;
        if (atCurrentPaceReachesLimitAt >= win.resetsAt) {
          // Reset happens before pace reaches 100 · no forecast cross.
          atCurrentPaceReachesLimitAt = null;
        } else if (atCurrentPaceReachesLimitAt < now) {
          atCurrentPaceReachesLimitAt = now;
        }
      }
    }
  } else if (usedPercent >= 100) {
    atCurrentPaceReachesLimitAt = now;
  }

  const msRemaining = Math.max(0, win.resetsAt - now);
  const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);

  return {
    windowKind: win.kind,
    ...(win.model ? { model: win.model } : {}),
    elapsedPercent,
    usedPercent,
    expectedUsedPercent,
    daysRemaining,
    atCurrentPaceReachesLimitAt,
    recommendation,
  };
}

/** Forecast every window in a snapshot · skips windows that can't
 *  be projected (missing resetsAt / zero duration). */
export function forecastSnapshot(
  snapshot: UsageSnapshot,
  opts: ForecastOpts = {},
): ForecastResult[] {
  const out: ForecastResult[] = [];
  for (const win of snapshot.windows) {
    const forecast = forecastWindow(win, opts);
    if (forecast) out.push(forecast);
  }
  return out;
}

/** Adapter back to the canonical `UsagePace` shape declared in
 *  `types.ts`. Used by BudgetForecast LLM tool output. */
export function toUsagePace(f: ForecastResult): UsagePace {
  return {
    windowKind: f.windowKind,
    elapsedPercent: f.elapsedPercent,
    usedPercent: f.usedPercent,
    expectedUsedPercent: f.expectedUsedPercent,
    daysRemaining: f.daysRemaining,
    atCurrentPaceReachesLimitAt: f.atCurrentPaceReachesLimitAt,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
