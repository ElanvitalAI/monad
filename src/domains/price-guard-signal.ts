import { decidePriceGuard } from './price-guard-policy.js';
import type { Signal } from './signal-pool.js';
import type { PriceGuardSnapshot } from '../../scripts/price-guard-cycle.js';

/** 1h 모멘텀 movement 신호 기본 임계(%) — |1h 변동| 이상이면 급락/급등 알림. 튜닝축. */
export const MOMENTUM_THRESHOLD_PCT = 3;

/**
 * Converts a price-guard snapshot into one ingest-ready market signal when the
 * existing policy identifies a critical protective event. Collection remains
 * side-effect free; callers own SignalPool.ingest and downstream routing.
 */
export function priceObservationToSignal(snapshot: PriceGuardSnapshot): Signal | null {
  const decision = decidePriceGuard({
    symbol: snapshot.symbol,
    current: snapshot.price,
    state: snapshot.state,
    previousRegime: snapshot.previousRegime,
    regime: snapshot.regime,
    held: snapshot.held,  // 미보유면 청산/트림/래더 트리거 억제(유령매도 방어)
  });
  const critical = decision.triggers.find(trigger => trigger.severity === 'critical');
  if (!critical) return null;

  const changePct = snapshot.referencePrice === 0
    ? 0
    : ((snapshot.price - snapshot.referencePrice) / snapshot.referencePrice) * 100;
  const heldTag = snapshot.held ? ' [held]' : '';
  const action = `protect ${critical.action.toLowerCase()}`;

  return {
    eventId: `price-guard:${snapshot.symbol}:${snapshot.timestamp}:${critical.kind}`,
    source: 'market',
    asset: snapshot.symbol,
    observedAt: snapshot.timestamp,
    collectedAt: snapshot.timestamp,
    origin: 'price-guard-cycle',
    trust: 1,
    proposedAction: action,
    dedupGroup: `price-guard:${snapshot.symbol}:${critical.kind}`,
    raw: `price-guard 급락 ${snapshot.symbol} ${changePct.toFixed(1)}%${heldTag}; ${critical.severityReason}; ${action}`,
  };
}

/**
 * 1h 모멘텀 movement 신호(대표 지시 2026-07-15) — 감시 종목의 "1시간 대비" 급락/급등을
 * **보유 여부와 무관**하게 알린다. 매도/매수가 아니라 정보성 움직임(watch) — exit_all 과 별개.
 * 기준은 롤링 1h 시세(다이나믹 레벨). |1h 변동| < 임계면 null(잔잔).
 */
export function priceMomentumToSignal(snapshot: PriceGuardSnapshot, thresholdPct = MOMENTUM_THRESHOLD_PCT): Signal | null {
  const m = snapshot.momentum1h;
  if (!m || Math.abs(m.pct) < thresholdPct) return null;
  const up = m.pct > 0;
  const dir = up ? '급등' : '급락';
  const heldTag = snapshot.held ? ' [held]' : ' [watch·무포지션]';
  return {
    eventId: `price-move:${snapshot.symbol}:${snapshot.timestamp}`,
    source: 'market',
    asset: snapshot.symbol,
    observedAt: snapshot.timestamp,
    collectedAt: snapshot.timestamp,
    origin: 'price-guard-momentum',
    trust: 1,
    proposedAction: 'watch momentum',   // 매도/매수 아님 — 정보성 1h 움직임 알림
    dedupGroup: `price-move:${snapshot.symbol}:${up ? 'up' : 'down'}`,
    raw: `price-move ${snapshot.symbol} 1h ${dir} ${m.pct.toFixed(1)}%${heldTag}; 현재 ${snapshot.price} vs ${m.refAgeMin}분전 ${m.refPrice}(다이나믹 1h 기준)`,
  };
}
