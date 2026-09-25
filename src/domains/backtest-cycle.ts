// ── 백테스팅 루프 오케스트레이터 (B5 · backtest-cycle · 2026-07-08) ────────
//
// 장중 1틱: 그날 정보 → 가설 생성 → 미니 백테스트 → 승격 게이트 → 페이퍼 →
// 반자동 승격. 순수 오케스트레이터(deps 주입 seam) + scripts/backtest-cycle.ts
// 실배선. dry(페이퍼) 기본 · 실집행은 aggressive.armed 게이트로만(B4).
//
// deps: getContext(그날 정보·B5 실배선에서 dig·sector·regime 조립) ·
//       runBacktest(가설→결과·factor-backtest 호출·B0) ·
//       recordPaper(CONFIRMED 페이퍼 체결·B3) · now(테스트 seam).
// [[PLAN-quant-backtest-retro-loops-2026-07-08]] §3.1 · [[ROADMAP-...]] B5.

import { Database } from 'bun:sqlite';
import { insertExperiment, insertResult, type ExperimentResult, type PortfolioExperiment } from './backtest-store.js';
import { generateHypotheses, toExperiment, type MarketContext, type PortfolioHypothesis } from './backtest-hypothesis.js';
import { evaluateGate } from './backtest-gate.js';
import { decidePromotion, promotionNotice, type PromotionDecision } from './backtest-promote.js';
import { applyHardCap, budgetExhausted, type StopBudget } from './loop-contract.js';
import type { FundAllocation } from './trade-mandate.js';

/** 한 틱당 가설 하드캡 기본값 — stop 미지정 시 적용(과다연산 차단·Phase C). */
export const DEFAULT_MAX_HYPOTHESES = 12;

export interface CycleDeps {
  /** 가설 → 미니 백테스트 결과(M-1/2/3 + 학술 게이트). factor-backtest(B0) 호출. */
  runBacktest: (h: PortfolioHypothesis, exp: PortfolioExperiment) => ExperimentResult | null;
  /** CONFIRMED 실험 페이퍼 체결 기록(B3). 선택 — 없으면 페이퍼 스킵. */
  recordPaper?: (exp: PortfolioExperiment) => void;
  /** 승격 사후 알림 발송(선택). */
  notify?: (text: string) => void;
  /** 이번 틱 stop 예산(가설 N개/시간). 미지정 시 DEFAULT_MAX_HYPOTHESES(Phase C). */
  stop?: StopBudget;
  now?: () => string;
  /** 데드라인 판정용 시각(epoch ms·테스트 seam). 미지정 시 Date.now(). */
  nowMs?: () => number;
}

export interface CycleReport {
  runDate: string;
  hypotheses: number;
  tested: number;
  confirmed: number;
  experiments: string[];
  promotions: PromotionDecision[];
  /** 하드캡·데드라인으로 중단됐으면 true(Phase C stop). */
  stopped: boolean;
  /** 처리 못 하고 이월된 가설 수(Phase C). */
  dropped: number;
  note: string;
}

/** 백테스팅 루프 1틱(순수 오케스트레이터). 실집행 없음 — 페이퍼·판정만. */
export function runBacktestCycle(
  db: Database, ctx: MarketContext, deps: CycleDeps, aggressive: FundAllocation,
): CycleReport {
  const now = deps.now?.() ?? new Date().toISOString();
  const nowMs = deps.nowMs ?? (() => Date.now());
  // ★ Phase C: stop 예산 — 가설 하드캡(N개) + (선택) 시간 데드라인. 미지정=기본캡.
  const stop: StopBudget = deps.stop ?? { maxItems: DEFAULT_MAX_HYPOTHESES };
  const all = generateHypotheses(ctx);
  const cap = applyHardCap(all, stop);
  const experiments: string[] = [];
  const promotions: PromotionDecision[] = [];
  let tested = 0, confirmed = 0;
  let deadlineHit = false;

  for (const h of cap.items) {
    if (budgetExhausted(stop, nowMs())) { deadlineHit = true; break; }  // 시간 예산 소진 → 중단
    const exp = toExperiment(h, ctx.date, now);
    insertExperiment(db, exp);
    experiments.push(exp.id);

    const result = deps.runBacktest(h, exp);
    if (!result) continue;               // 백테스트 불가(데이터 부족 등) — 다음
    insertResult(db, result);
    tested++;

    const gate = evaluateGate(result);
    if (gate.verdict !== 'CONFIRMED') continue;
    confirmed++;

    // CONFIRMED → 페이퍼 체결(있으면) → 승격 판정.
    deps.recordPaper?.(exp);
    const promo = decidePromotion(db, exp.id, aggressive);
    promotions.push(promo);
    const notice = promotionNotice(promo);
    if (notice && deps.notify) deps.notify(notice);
  }

  const stopped = cap.capped || deadlineHit;
  const dropped = cap.dropped + (deadlineHit ? cap.items.length - experiments.length : 0);
  const armed = aggressive.armed && aggressive.live;
  const capNote = stopped ? ` · stop(${deadlineHit ? '시간예산 소진' : cap.reason})` : '';
  const note = (armed
    ? `aggressive armed — 승격분 반자동 실집행 자격`
    : `페이퍼·disarmed(실집행 0·대표 arm 대기)`) + capNote;
  return { runDate: ctx.date, hypotheses: cap.items.length, tested, confirmed, experiments, promotions, stopped, dropped, note };
}
