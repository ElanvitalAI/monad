// ── 페이퍼 트레이딩 ledger + ρ 실측 (B3 · backtest-paper · 2026-07-08) ────
//
// CONFIRMED 실험을 페이퍼(가상)로 집행하고 실체결 대비 ρ(장중 포착률)를 실측.
// Perold(1988) Implementation Shortfall 프레임 — 캡스톤 methodology/IS_TCA_realized_rho_spec:
//   IS_fraction = (P_fill − P_decision)/P_decision × sign(side)   (양수=불리한 체결)
//   ρ = 1 − IS_fraction                                          (1=완벽 포착·decision가 체결)
//   gap_component      = (open − P_decision)/P_decision          (overnight 갭 = D/PSD 최대 성분)
//   intraday_component = (P_fill − open)/P_decision              (장중 슬리피지)
//
// 대표 결정: 페이퍼→검증후 실자금(관찰 20 거래일). 실집행 0 — mandate funds.aggressive
// 게이트 전. [[PLAN-quant-backtest-retro-loops-2026-07-08]] §3.1 · §4.3.

import { Database } from 'bun:sqlite';
import { insertPaperFill, listPaperFills, type PaperFill, type PortfolioExperiment } from './backtest-store.js';

export interface FillObservation {
  expId: string; tsSignal: string; symbol: string; side: 'buy' | 'sell';
  targetExposure: number;
  pDecision: number;    // 신호 확정 시점 이론가(전일 종가·arrival price)
  open: number;         // 체결일 시가(갭 분해용)
  pFillVwap: number;    // 실제/가정 평균체결가(페이퍼=VWAP 가정)
  qty: number;
  feeBps?: number;
}

/** Perold IS 분해(순수). 양수 IS=불리. ρ=1−IS. */
export function decomposeIS(o: { pDecision: number; open: number; pFillVwap: number; side: 'buy' | 'sell' }): {
  isFraction: number; gapComponent: number; intradayComponent: number; rhoRealized: number;
} {
  const sign = o.side === 'buy' ? 1 : -1;
  const isFraction = ((o.pFillVwap - o.pDecision) / o.pDecision) * sign;
  const gapComponent = ((o.open - o.pDecision) / o.pDecision) * sign;
  const intradayComponent = ((o.pFillVwap - o.open) / o.pDecision) * sign;
  return { isFraction, gapComponent, intradayComponent, rhoRealized: 1 - isFraction };
}

/** 페이퍼 체결 1건 기록 — IS 분해 + slippage(bps) 산출 후 paper_fills 적재. */
export function recordPaperFill(db: Database, o: FillObservation): PaperFill {
  const d = decomposeIS(o);
  const fill: PaperFill = {
    expId: o.expId, tsSignal: o.tsSignal, symbol: o.symbol, side: o.side,
    targetExposure: o.targetExposure, pDecision: o.pDecision, pFillVwap: o.pFillVwap,
    qty: o.qty, notional: o.pFillVwap * o.qty,
    gapComponent: d.gapComponent, intradayComponent: d.intradayComponent,
    rhoRealized: d.rhoRealized,
    slippageBps: d.isFraction * 10_000,   // IS_fraction → bps
    feeBps: o.feeBps ?? 0,
  };
  insertPaperFill(db, fill);
  return fill;
}

export interface PaperSummary {
  expId: string;
  fills: number;
  observeDays: number;      // distinct 거래일 수(대표 결정: 20일 관찰)
  meanRho: number;          // 평균 장중 포착률
  meanSlippageBps: number;
  meanGapBps: number;       // overnight 갭 성분(D/PSD 신호 취약도)
  notional: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** 실험의 페이퍼 성과 집계 — ρ 실측·관찰일수(20일 승격 판정용). */
export function summarizePaper(db: Database, expId: string): PaperSummary {
  const fills = listPaperFills(db, expId);
  if (fills.length === 0) {
    return { expId, fills: 0, observeDays: 0, meanRho: 0, meanSlippageBps: 0, meanGapBps: 0, notional: 0, firstDate: null, lastDate: null };
  }
  const dates = fills.map(f => f.tsSignal.slice(0, 10));
  const uniqueDays = new Set(dates);
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sorted = [...dates].sort();
  return {
    expId,
    fills: fills.length,
    observeDays: uniqueDays.size,
    meanRho: mean(fills.map(f => f.rhoRealized)),
    meanSlippageBps: mean(fills.map(f => f.slippageBps)),
    meanGapBps: mean(fills.map(f => f.gapComponent * 10_000)),
    notional: fills.reduce((s, f) => s + f.notional, 0),
    firstDate: sorted[0] ?? null,
    lastDate: sorted[sorted.length - 1] ?? null,
  };
}

/** 종목 최근 2일 가격(전일 종가=decision·당일 시가/종가=fill). 실배선이 주입. */
export interface RecentBar { prevClose: number; open: number; close: number }

export interface PaperRecordDeps {
  recentBars: (symbol: string) => RecentBar | null;   // 가격 로더(screener/us_pulse)
  now: string;                                        // ISO(체결 시각)
}

/** CONFIRMED 실험을 오늘 페이퍼 체결(등비중·매일 1회·중복 방지). ρ 실측 축적.
 *  같은 실험·같은 날 이미 체결했으면 skip → observeDays 는 distinct 거래일. 신규 체결 수 반환. */
export function recordPaperForExperiment(db: Database, exp: PortfolioExperiment, deps: PaperRecordDeps): number {
  const today = deps.now.slice(0, 10);
  const already = (db.prepare(`SELECT COUNT(*) c FROM paper_fills WHERE exp_id=? AND ts_signal LIKE ?`).get(exp.id, `${today}%`) as { c: number }).c;
  if (already > 0) return 0;   // 오늘 이미 체결(중복 방지)
  const weight = 1 / Math.max(1, exp.universe.length);
  let n = 0;
  for (const sym of exp.universe) {
    const b = deps.recentBars(sym);
    if (!b || !(b.prevClose > 0)) continue;
    recordPaperFill(db, {
      expId: exp.id, tsSignal: deps.now, symbol: sym, side: 'buy',
      targetExposure: weight, pDecision: b.prevClose, open: b.open || b.close, pFillVwap: b.close,
      qty: 1,   // 페이퍼 — 수량 무의미(ρ·slippage 만 측정)
    });
    n++;
  }
  return n;
}

/** 페이퍼→실자금 승격 자격(B4에서 사용) — 관찰 20 거래일 + ρ 손익분기 이상.
 *  캡스톤 통합형 손익분기 ρ≥0.16 · 보수적으로 0.25 기본. */
export function paperReadyForLive(s: PaperSummary, opts: { minObserveDays?: number; minRho?: number } = {}): boolean {
  const minDays = opts.minObserveDays ?? 20;   // 대표 결정
  const minRho = opts.minRho ?? 0.25;          // 손익분기 여유(캡스톤 통합형 0.16 + margin)
  return s.observeDays >= minDays && s.meanRho >= minRho && s.fills > 0;
}
