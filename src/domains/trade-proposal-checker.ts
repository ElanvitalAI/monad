// ── Phase B1 · trade 제안 독립 checker (builder != checker · 2026-07-08) ──
//
// 캐논 1번 교훈을 trade 에 이식. 델타 주문을 "만든" 로직(trade-strategy
// computeDeltaOrders = builder)과 분리된, 주문의 건전성을 판정하는 독립
// checker. evaluateMandate 는 "권한"(거래 허가·armed/live/세션/focus)이지
// 제안 품질 검증이 아니다 — 이 checker 가 그 공백(자기채점 = "실수 화로")을
// 메운다.
//
// ★ Stage 1(현): 기존 집행 흐름과 동치가 되는 보수 체크만(회귀 0). 판정은
//   trade-cycle 이 mode='advisory'로 호출해 기록만 한다. computeDeltaOrders 가
//   이미 price=0·먼지 주문을 거르므로, 실제 집행되던 정상 주문은 아래 두 체크를
//   모두 통과한다(회귀 0 보장).
// ★ Stage 2(후속 PR): freshness 감쇠·신호↔실측 괴리·리스크 체크를
//   combineChecks 에 추가 + mode='enforce' 승격. context 필드는 지금 미리
//   확보한다(TradeCheckContext).
//
// 근거: 내부 문서 `PLAN-loop-engineering-finance-reconnect-2026-07-08` §4 Phase B1.

import type { DeltaOrder } from './trade-strategy.js';
import { combineChecks, type CheckerVerdict, type CheckResult } from './loop-contract.js';

/** freshness 최소 데이터 건강도 기본값(0~1). 이 미만이면 "낡은 국면" 판정. */
export const DEFAULT_MIN_REGIME_CONFIDENCE = 0.2;

/** signal-gap 방향 괴리 임계 기본값. composite 이 이 크기 이상 음(-)일 때 롱리스크 신규
 *  매수(BUY)를 "깊은 risk-off 에서의 신호↔실측 괴리"로 보고 차단. composite 범위 ~±0.6. */
export const DEFAULT_MAX_DIRECTION_GAP = 0.5;

/** gap 축에서 방향 괴리로 차단하지 않는(면제) 주문 role — 헤지/방어 매수는 risk-off 에서
 *  오히려 정당하다(인버스 ETF 매수 = de-risking). trade-strategy TargetLeg.role 과 일치. */
export const GAP_EXEMPT_ROLES = new Set(['inverse2x']);

export interface TradeCheckContext {
  /** normSym 키 → 현재가(원). 0/미상 = 가격 불명. */
  prices: Record<string, number>;
  /** 국면 읽기 데이터 건강도(0~1·가중평균 confidence·regimeDataHealth). freshness
   *  프록시. undefined=미주입 → 보수 통과(회귀 안전). */
  regimeConfidence?: number;
  /** freshness 최소 임계(기본 DEFAULT_MIN_REGIME_CONFIDENCE). */
  minRegimeConfidence?: number;
  /** 국면 전환(브레이크) 관측용. 집행 정지는 mandate 재승인이 담당(중복 게이트 아님). */
  regimeTransition?: boolean;
  /** ★ Stage 2 · risk 축 — 주문당 상한(원·mandate.maxOrderKrw). null/undefined = 상한
   *  없음 → 보수 통과(회귀 안전·현 실운영은 null). qty×price 가 이 상한 초과면 미승인. */
  maxOrderKrw?: number | null;
  /** ★ Stage 2 · gap 축 — 국면 합성 스코어(~±0.6·regimeBrake.composite). undefined =
   *  미주입 → 보수 통과. 깊은 음(-)에서의 신규 매수를 신호↔실측 괴리로 차단. */
  regimeComposite?: number;
  /** gap 축 방향 괴리 임계(기본 DEFAULT_MAX_DIRECTION_GAP). */
  maxDirectionGap?: number;
}

/** 심볼 정규화 — trade-strategy.normSym 과 동일 규칙(로컬 복제로 결합도 최소화). */
function normKey(sym: string): string {
  return sym.replace(/\.(KO|KS|KQ|US)$/i, '').toUpperCase().trim();
}

/** 국면 데이터 건강도가 충분히 신선한가. undefined(미주입)=true(보수·회귀 안전). */
export function regimeFreshnessOk(confidence: number | undefined, minConfidence = DEFAULT_MIN_REGIME_CONFIDENCE): boolean {
  return confidence === undefined || confidence >= minConfidence;
}

/** ★ risk 축 — 주문 명목가(qty×price)가 상한 이내인가. cap null/undefined/≤0 = 상한
 *  없음(보수 통과). price 미상(0)은 price-known 축이 이미 잡으므로 여기선 통과. */
export function exposureOk(notionalKrw: number, maxOrderKrw: number | null | undefined): boolean {
  return maxOrderKrw == null || maxOrderKrw <= 0 || notionalKrw <= maxOrderKrw;
}

/** ★ gap 축 — 신호↔실측 괴리. 깊은 risk-off(composite ≤ -임계)에서 "롱리스크" 신규
 *  매수(BUY)만 차단(builder 의 국면 읽기가 독립 composite 와 어긋나는 경우). 매도는
 *  de-risking 이라 항상 통과, 헤지 매수(inverse2x role)도 면제 — 차단은 늘 더 보수적.
 *  composite 미주입=보수 통과. */
export function directionGapOk(side: 'buy' | 'sell', composite: number | undefined, role?: string, maxGap = DEFAULT_MAX_DIRECTION_GAP): boolean {
  if (composite === undefined || side !== 'buy') return true;
  if (role && GAP_EXEMPT_ROLES.has(role)) return true; // 헤지 매수는 risk-off 에서 정당
  return composite > -Math.abs(maxGap);
}

/**
 * 델타 주문 1건을 독립 판정(builder != checker).
 *  Stage 1 (보수·회귀 0): well-formed(qty>0·symbol) · price-known(현재가>0).
 *    computeDeltaOrders 가 이미 price=0·먼지를 거르므로 현재 집행되던 주문은 통과.
 *  Stage 2 (freshness): regime-freshness — 국면 데이터 건강도가 임계 미만(낡은 국면)
 *    이면 미승인. "낡은 국면 위 자율 집행"(실수 화로) 차단. 미주입=보수 통과.
 * 차단은 항상 더 보수적(refused) — mandate 가 허가할 것을 checker 가 새로 열지 않는다.
 */
export function checkTradeProposal(order: DeltaOrder, ctx: TradeCheckContext): CheckerVerdict {
  const price = ctx.prices[normKey(order.symbol)] ?? 0;
  const minConf = ctx.minRegimeConfidence ?? DEFAULT_MIN_REGIME_CONFIDENCE;
  const maxGap = ctx.maxDirectionGap ?? DEFAULT_MAX_DIRECTION_GAP;
  const freshPass = regimeFreshnessOk(ctx.regimeConfidence, minConf);
  const notionalKrw = order.qty * price;
  const riskPass = exposureOk(notionalKrw, ctx.maxOrderKrw);
  const gapPass = directionGapOk(order.side, ctx.regimeComposite, order.role, maxGap);
  const checks: CheckResult[] = [
    {
      name: 'well-formed',
      passed: order.qty > 0 && !!order.symbol,
      detail: `qty=${order.qty} symbol=${order.symbol || '(빈값)'}`,
    },
    {
      name: 'price-known',
      passed: price > 0,
      detail: price > 0 ? `현재가 ${price.toLocaleString()}원` : '현재가 미상(0)',
    },
    {
      name: 'regime-freshness',
      passed: freshPass,
      detail: ctx.regimeConfidence === undefined
        ? '국면 신선도 미주입(보수 통과)'
        : `국면 데이터 건강도 ${Math.round(ctx.regimeConfidence * 100)}% (최소 ${Math.round(minConf * 100)}%)`,
    },
    {
      // ★ Stage 2 · risk 축 — 주문당 노출 상한.
      name: 'risk-exposure',
      passed: riskPass,
      detail: ctx.maxOrderKrw == null || ctx.maxOrderKrw <= 0
        ? '주문 상한 없음(보수 통과)'
        : `명목가 ${notionalKrw.toLocaleString()}원 (상한 ${ctx.maxOrderKrw.toLocaleString()}원)`,
    },
    {
      // ★ Stage 2 · gap 축 — 신호↔실측 방향 괴리(깊은 risk-off 신규 매수 차단).
      name: 'signal-gap',
      passed: gapPass,
      detail: ctx.regimeComposite === undefined
        ? '국면 스코어 미주입(보수 통과)'
        : order.side !== 'buy'
          ? `매도(de-risking·괴리 무관) · composite ${ctx.regimeComposite.toFixed(2)}`
          : order.role && GAP_EXEMPT_ROLES.has(order.role)
            ? `헤지 매수(${order.role}·risk-off 정당) · composite ${ctx.regimeComposite.toFixed(2)}`
            : `롱리스크 매수 vs 국면 composite ${ctx.regimeComposite.toFixed(2)} (하한 -${Math.abs(maxGap).toFixed(2)})`,
    },
  ];
  return combineChecks(checks);
}
