import {
  computeLadderTriggers,
  computeTrailingStops,
  KORU_LADDER,
  type LadderRung,
  type SwingState,
  type TrailingAction,
} from './koru-trailing.js';
import type { RegimeVector } from './regime-synth.js';

export type PriceGuardTriggerKind =
  | 'TRAILING_EXIT'
  | 'TRAILING_TRIM'
  | 'LADDER'
  | 'CAPSTONE_WARNING';

export type PriceGuardSeverity = 'info' | 'warning' | 'critical';

export interface PriceGuardTrigger {
  kind: PriceGuardTriggerKind;
  symbol: string;
  severity: PriceGuardSeverity;
  severityReason: string;
  /** Whether the position remains held after this read-only recommendation. */
  held: boolean;
  action: TrailingAction | 'TAKE_PROFIT' | 'HOLD_AND_REVIEW';
  current: number;
  levels: number[];
  compositeDrop?: number;
  transitionAxes?: string[];
}

export interface PriceGuardDecision {
  symbol: string;
  /** False only when the trailing policy recommends an all-position exit. */
  held: boolean;
  triggers: PriceGuardTrigger[];
}

export interface PriceGuardPolicyInput {
  symbol: string;
  current: number;
  /** Existing KORU trailing and ladder state shape; policy never persists it. */
  state: Pick<SwingState, 'highwater' | 'entryPrice' | 'firedLadder'>;
  ladder?: readonly LadderRung[];
  previousRegime?: RegimeVector | null;
  regime?: RegimeVector | null;
  /** Minimum adverse composite move needed alongside two sign flips. Default: 0.1. */
  compositeDropThreshold?: number;
  /**
   * Whether the position is actually held. Position-management triggers (trailing
   * exit/trim, profit ladder) require a real position — they are suppressed when
   * held === false. Omitted (undefined) is treated as held for backward-compat.
   *
   * ★ 유령매도 근본 방어: 미보유 감시종목은 state.entryPrice 가 current 로 초기화돼
   *   exitAll = max(rawExit, entryPrice) = current → current<=exitAll → 매 사이클 EXIT_ALL
   *   유령 발사(0% 변동에도). 보유 여부로 게이팅해 없는 포지션의 청산/트림/래더를 차단.
   */
  held?: boolean;
}

/**
 * Pure price-guard decision policy. It only combines the legacy trailing and
 * ladder calculations with a regime-collapse warning; it does not mutate state
 * or place orders.
 */
export function decidePriceGuard(input: PriceGuardPolicyInput): PriceGuardDecision {
  const ladder = input.ladder ?? KORU_LADDER;
  const stops = computeTrailingStops(input.state.highwater, input.state.entryPrice, input.current);
  const ladderTrigger = computeLadderTriggers(input.current, input.state.firedLadder, [...ladder]);
  const triggers: PriceGuardTrigger[] = [];
  // 포지션 관리 트리거(청산·트림·래더)는 실보유에만 유효. 미보유(held===false)면 억제 —
  // 없는 포지션의 유령 청산/트림/익절을 원천 차단. undefined 는 하위호환상 보유로 취급.
  const isHeld = input.held !== false;

  if (isHeld && stops.action === 'EXIT_ALL') {
    triggers.push({
      kind: 'TRAILING_EXIT', symbol: input.symbol, severity: 'critical',
      severityReason: `current ${input.current} is at or below exit ${stops.exitAll}`,
      held: false, action: stops.action, current: input.current, levels: [stops.exitAll],
    });
  } else if (isHeld && (stops.action === 'TRIM_25' || stops.action === 'TRIM_50')) {
    triggers.push({
      kind: 'TRAILING_TRIM', symbol: input.symbol, severity: 'warning',
      severityReason: `current ${input.current} crossed ${stops.action} trailing level`,
      held: true, action: stops.action, current: input.current,
      levels: [stops.action === 'TRIM_25' ? stops.trim25 : stops.trim50],
    });
  }

  if (isHeld && ladderTrigger.triggered.length > 0) {
    triggers.push({
      kind: 'LADDER', symbol: input.symbol, severity: 'info',
      severityReason: `${ladderTrigger.triggered.length} unfired profit ladder level(s) reached`,
      held: true, action: 'TAKE_PROFIT', current: input.current,
      levels: ladderTrigger.triggered.map(rung => rung.level),
    });
  }

  const capstone = capstoneWarning(input);
  if (capstone) triggers.push(capstone);

  return { symbol: input.symbol, held: !triggers.some(trigger => !trigger.held), triggers };
}

function round3(value: number): number { return Math.round(value * 1000) / 1000; }

function capstoneWarning(input: PriceGuardPolicyInput): PriceGuardTrigger | null {
  const previous = input.previousRegime;
  const current = input.regime;
  if (!previous || !current) return null;

  const compositeDrop = previous.composite - current.composite;
  const transitionAxes = [...current.transitionAxes].sort();
  const threshold = input.compositeDropThreshold ?? 0.1;
  if (round3(compositeDrop) <= threshold || transitionAxes.length < 2) return null;

  return {
    kind: 'CAPSTONE_WARNING', symbol: input.symbol, severity: 'warning',
    severityReason: `composite fell ${compositeDrop.toFixed(3)} with ${transitionAxes.length} sign-flip axes`,
    held: true, action: 'HOLD_AND_REVIEW', current: input.current, levels: [],
    compositeDrop: round3(compositeDrop), transitionAxes,
  };
}
