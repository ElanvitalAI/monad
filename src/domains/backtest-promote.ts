// ── 반자동 승격 (B4 · backtest-promote · 2026-07-08) ──────────────────────
//
// 백테스팅 실험의 승격 단계를 결정하는 순수 판정 + 이력 기록. 대표 결정:
//  - 페이퍼→검증후 실자금(관찰 20 거래일) · 반자동(mandate형): 기준 충족 시
//    소액 자동 집행 + 사후 알림. 컨셉/범위 변경만 재승인.
//
// 승격 사다리:
//  CONFIRMED(게이트) → paper(페이퍼 진입) → [관찰 20일+ρ] → live-candidate
//    → [aggressive.armed=대표 arm] → live-armed(실집행 자격)
//  aggressive.armed=false 면 live-candidate 까지만(실집행 0·대표 arm 대기).
//
// [[PLAN-quant-backtest-retro-loops-2026-07-08]] §4.3 · [[ROADMAP-...]] B4.

import { Database } from 'bun:sqlite';
import { latestResult, insertPromotion, type PromotionStage } from './backtest-store.js';
import { evaluateGate, isPaperEligible } from './backtest-gate.js';
import { summarizePaper, paperReadyForLive } from './backtest-paper.js';
import type { FundAllocation } from './trade-mandate.js';

export interface PromotionDecision {
  expId: string;
  stage: PromotionStage | 'none';
  eligible: boolean;          // 다음 단계 진입 자격
  decidedBy: 'auto' | 'hitl:owner';
  reason: string;
}

/** 실험의 현재 승격 단계 판정(순수 판단 + 기록). 실집행은 하지 않음(자격만). */
export function decidePromotion(
  db: Database, expId: string, aggressive: FundAllocation,
  opts: { record?: boolean } = {},
): PromotionDecision {
  const result = latestResult(db, expId);
  if (!result) {
    return { expId, stage: 'none', eligible: false, decidedBy: 'auto', reason: '결과 없음(미검증)' };
  }
  const gate = evaluateGate(result);
  if (!isPaperEligible(gate)) {
    return { expId, stage: 'none', eligible: false, decidedBy: 'auto', reason: `게이트 ${gate.verdict}(페이퍼 불가)` };
  }

  // CONFIRMED — 페이퍼 성과 확인.
  const paper = summarizePaper(db, expId);
  const observeDays = aggressive.observeDays ?? 20;
  const ready = paperReadyForLive(paper, { minObserveDays: observeDays });

  let decision: PromotionDecision;
  if (!ready) {
    decision = {
      expId, stage: 'paper', eligible: false, decidedBy: 'auto',
      reason: `페이퍼 관찰 중(${paper.observeDays}/${observeDays}일·ρ ${paper.meanRho.toFixed(2)})`,
    };
  } else if (aggressive.armed && aggressive.live) {
    // 대표가 aggressive fund 를 arm 함 → 반자동 실집행 자격(사후 알림).
    decision = {
      expId, stage: 'live-armed', eligible: true, decidedBy: 'auto',
      reason: `페이퍼 통과(${paper.observeDays}일·ρ ${paper.meanRho.toFixed(2)}) → aggressive 실집행 자격(사후알림)`,
    };
  } else {
    // 페이퍼 통과했으나 aggressive disarmed → 대표 arm 대기.
    decision = {
      expId, stage: 'live-candidate', eligible: false, decidedBy: 'auto',
      reason: `페이퍼 통과 → 실자금 후보(대표 aggressive arm 대기·현 disarmed)`,
    };
  }

  if (opts.record !== false) {
    insertPromotion(db, {
      ts: new Date().toISOString(), expId, stage: decision.stage === 'none' ? 'paper' : decision.stage,
      reason: decision.reason, observeDays, decidedBy: decision.decidedBy, fund: 'aggressive',
    });
  }
  return decision;
}

/** 승격 알림 메시지(사후) — 반자동 실집행 시 대표에게 통지. */
export function promotionNotice(d: PromotionDecision): string | null {
  if (d.stage === 'live-armed') {
    return `🚀 백테스팅 승격 — ${d.expId}\n${d.reason}\n(aggressive fund 반자동 집행·mandate 게이트 통과)`;
  }
  if (d.stage === 'live-candidate') {
    return `📋 실자금 후보 — ${d.expId}\n${d.reason}`;
  }
  return null;
}
