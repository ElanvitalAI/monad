// ── 캡스톤 운영안 — 통합 선제방어형(기본) + §4.1 LV형(옵션) (2026-07-07) ──
//
// 원본: capstone v052-web 보고서. 2026-07-07 대표 지시로 기본 운영을
// **통합 선제방어형**(§2.2.1 hero 77.02억 · 방패 A+B+C+D + 창 E · 무레버)으로 전환.
// 백테스트 build_nav_series 매핑 그대로:
//
//   [선제방어형 · 기본]
//   강세/중립       1.0× = 본주 100%
//   약세 R3 회복    1.0× = 본주 100% 재진입 (C 조기 ride)
//   약세 비회복     0×   = 스마트현금 100% (R3 대기 · E 슬리브 원천)
//   🚨 PSD K≥2     -1.0× = 2×인버스 50% + cash 50% (1~2일 헤지)
//   창 E: 방어 유휴현금 30% dip 매수 (독립 슬리브 — 신호는 capstone-signals E)
//
//   [LV형 · 옵션 §4.1 — mode='lv'] 1.5× / 1.75× / -0.25× / -1.25× (레버 합성)
//
// 순수 로직(주문 없음). 실제 금액 분해·집행은 finance-tools/trade-executor.

import type { CapstoneTarget } from './capstone-signals.js';

/** 운영 모드 — 기본 = 통합 선제방어형 (대표 결정 2026-07-07). */
export type OperatingMode = 'preemptive' | 'lv';
export const DEFAULT_OPERATING_MODE: OperatingMode = 'preemptive';

/** 국면 (노출 배수로 명명 — 선제방어형 4 + LV형 4). */
export type LeverageRegime =
  | 'BULL_1X' | 'R3_1X' | 'BEAR_CASH' | 'PSD_-1X'                 // 선제방어형
  | 'BULL_1_5X' | 'R3_1_75X' | 'BEAR_-0_25X' | 'PSD_-1_25X';      // LV형(§4.1)

/** 합성 구성 비율 (합=1.0). 각 leg는 자산의 이 비율만큼 배정. */
export interface SynthWeights {
  stock: number;      // 본주 (005930), 배수 1
  lev2x: number;      // 2× 레버리지 ETF, 배수 +2
  inverse2x: number;  // 2× 인버스 ETF, 배수 -2
  cash: number;       // 현금, 배수 0
}

export interface LeveragePlan {
  regime: LeverageRegime;
  label: string;
  /** 목표 실효 노출 배수 (합성이 만드는 값). */
  targetExposure: number;
  weights: SynthWeights;
  /** weights로부터 실제 계산된 실효 노출 (검증용 — targetExposure와 일치해야). */
  effectiveExposure: number;
  note: string;
}

/** KRX 합성 ETF 심볼 (전부 확정). */
export const CAPSTONE_ETFS = {
  stock: '005930',       // 삼성전자 본주
  lev2x: '0193W0',       // KODEX 삼성전자레버리지 (2X) — samsung_rebuy.py 확인
  inverse2x: '0193L0',   // PLUS 삼성전자선물단일종목인버스2X (한화자산운용) — 대표 확정 2026-07-06
} as const;

/** weights → 실효 노출 (검산용). stock·1 + lev2x·2 + inverse2x·(-2) + cash·0. */
export function effectiveExposure(w: SynthWeights): number {
  return w.stock * 1 + w.lev2x * 2 + w.inverse2x * -2 + w.cash * 0;
}

/** 국면(target + bear/r3) → 운영 플랜.
 *  기본 = 통합 선제방어형(백테스트 build_nav_series 매핑: t=1/0/1/-1 그대로) ·
 *  mode='lv' 는 §4.1 레버리지형 유지 (연구/비교용). */
export function decideLeverage(
  target: CapstoneTarget,
  bear: boolean,
  r3: boolean,
  mode: OperatingMode = DEFAULT_OPERATING_MODE,
): LeveragePlan {
  let regime: LeverageRegime;
  let weights: SynthWeights;
  let label: string;
  let targetExposure: number;

  if (mode === 'preemptive') {
    if (target === 'HEDGE_1D' || target === 'HEDGE_HOLD') {
      regime = 'PSD_-1X';
      targetExposure = -1;
      weights = { stock: 0, lev2x: 0, inverse2x: 0.5, cash: 0.5 };
      label = '🚨 사전충격 PSD K≥2 — 인버스 헤지 -1× (1~2일)';
    } else if (target === 'CASH_100') {
      regime = 'BEAR_CASH';
      targetExposure = 0;
      weights = { stock: 0, lev2x: 0, inverse2x: 0, cash: 1 };
      label = '🛡️ 약세(비회복) — 스마트현금 100% (R3 대기·E 슬리브 30% 창)';
    } else if (bear && r3) {
      regime = 'R3_1X';
      targetExposure = 1;
      weights = { stock: 1, lev2x: 0, inverse2x: 0, cash: 0 };
      label = '🟢 약세 R3 회복 — 본주 100% 재진입 (조기 ride)';
    } else {
      regime = 'BULL_1X';
      targetExposure = 1;
      weights = { stock: 1, lev2x: 0, inverse2x: 0, cash: 0 };
      label = '🟢 강세/중립 — 본주 100%';
    }
    const eff = effectiveExposure(weights);
    return {
      regime, label, targetExposure, weights,
      effectiveExposure: eff,
      note: '통합 선제방어형(§2.2.1 hero·무레버) — 백테스트 spec(동적B+E30%+A_OR_KRW) 정합. LV형은 mode=lv.',
    };
  }

  if (target === 'HEDGE_1D' || target === 'HEDGE_HOLD') {
    regime = 'PSD_-1_25X';
    targetExposure = -1.25;
    weights = { stock: 0, lev2x: 0, inverse2x: 0.625, cash: 0.375 };
    label = '🚨 사전충격 PSD K≥2 — 강한 방어 -1.25× (2일)';
  } else if (target === 'CASH_100') {
    regime = 'BEAR_-0_25X';
    targetExposure = -0.25;
    weights = { stock: 0, lev2x: 0, inverse2x: 0.125, cash: 0.875 };
    label = '🔴 약세(비회복) — 가벼운 방어 -0.25×';
  } else if (bear && r3) {
    // target === 'LONG_100' 이면서 약세 R3 회복
    regime = 'R3_1_75X';
    targetExposure = 1.75;
    weights = { stock: 0.25, lev2x: 0.75, inverse2x: 0, cash: 0 };
    label = '🟢 약세 R3 회복 — 적극 재진입 1.75×';
  } else {
    // target === 'LONG_100' bull/중립
    regime = 'BULL_1_5X';
    targetExposure = 1.5;
    weights = { stock: 0.5, lev2x: 0.5, inverse2x: 0, cash: 0 };
    label = '🟢 강세/중립 — 가속 1.5×';
  }

  const eff = effectiveExposure(weights);
  return {
    regime, label, targetExposure, weights,
    effectiveExposure: eff,
    note: '§4.1 통합 LV형(옵션) — KRX 합성(본주+2×레버/인버스+cash). 실효노출은 합성으로 산출·검산됨.',
  };
}

/** 계좌 자산(순자산 KRW) → 각 leg의 목표 배정액. 실제 주문 수량 분해는 집행부. */
export interface LegAllocation { symbol: string; role: keyof SynthWeights; weight: number; krw: number; }

export function allocateLegs(plan: LeveragePlan, netAssetKrw: number): LegAllocation[] {
  const legs: LegAllocation[] = [];
  const push = (role: keyof SynthWeights, symbol: string): void => {
    const w = plan.weights[role];
    if (w > 0) legs.push({ symbol, role, weight: w, krw: Math.round(netAssetKrw * w) });
  };
  push('stock', CAPSTONE_ETFS.stock);
  push('lev2x', CAPSTONE_ETFS.lev2x);
  push('inverse2x', CAPSTONE_ETFS.inverse2x);
  push('cash', 'CASH');
  return legs;
}
