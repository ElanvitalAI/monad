// ── 실주문 인가 정책 (대표 결정 2026-07-22) ────────────────────────────
//
// 대표 정책: **명시 사용자 요청 → 승인(auto-approve) · 그 외(자율) → HITL 2단계 사람 승인**.
// 방화벽의 본질을 "실주문 코드 물리 부재"에서 "정책 강제 인가"로 전환. 이 모듈은
// 그 정책을 pure 함수로 표현한다(집행 아님 — 인가 판정만).
//
// ★ 불변식(정책이 안전하려면 필수):
//   1. "사용자 요청"은 **위조 불가 신뢰 origin**(진짜 사람 서피스=텔레그램/PWA 직접 발화)에서만.
//      `trustedUserOrigin` 은 서피스가 증명하는 별도 인자 — intent.source(코드가 자유설정=위조가능) 아님.
//   2. auto-approve 는 HITL '승인' 단계만 만족시킨다. verify 하드게이트 + 소액상한(executor)은 불변 적용.
//   3. 비신뢰/자율은 **항상** require-hitl(2단계 사람). fail-safe 기본 = require-hitl.

import type { TradeIntent } from './trade-hitl.js';

export interface OrderPolicyInput {
  intent: TradeIntent;
  /** ⚠️ 신뢰 origin — 진짜 사람 서피스가 증명(위조 불가). intent.source 로 대체 금지. */
  trustedUserOrigin: boolean;
}

export interface OrderPolicyDecision {
  /** 'auto-approve' = 대표 명시 요청(승인 단계 만족) · 'require-hitl' = 2단계 사람 승인 필요. */
  path: 'auto-approve' | 'require-hitl';
  reason: string;
}

/** 대표 정책 판정. 기본(비신뢰) = require-hitl(fail-safe). verify/상한은 별도로 항상 적용. */
export function resolveOrderPolicy(inp: OrderPolicyInput): OrderPolicyDecision {
  if (inp.trustedUserOrigin === true) {
    return { path: 'auto-approve', reason: '대표 명시 요청(신뢰 origin) — 승인 단계 자동 충족(verify·상한은 불변 적용)' };
  }
  return { path: 'require-hitl', reason: `자율/비신뢰 origin(source=${inp.intent.source}) → 2단계 HITL 사람 승인 필요` };
}

/** 정책 → HITL requestApproval 래퍼. auto-approve 면 승인 반환, 아니면 실 사람 approver 위임.
 *  ⚠️ trustedUserOrigin 은 반드시 서피스가 넘긴다(에이전트/루프가 true 설정 불가하도록 상위 배선). */
export function makePolicyApprover(
  trustedUserOrigin: boolean,
  humanApprover: (prompt: string, stage: 1 | 2) => Promise<{ approved: boolean; channel?: string }>,
): (prompt: string, stage: 1 | 2) => Promise<{ approved: boolean; channel?: string }> {
  return async (prompt, stage) => {
    if (trustedUserOrigin === true) return { approved: true, channel: 'policy:user-request' };
    return humanApprover(prompt, stage);
  };
}
