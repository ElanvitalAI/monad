import { describe, expect, test } from 'bun:test';
import { decidePriceGuard, type PriceGuardPolicyInput } from '../src/domains/price-guard-policy.js';
import type { RegimeVector } from '../src/domains/regime-synth.js';

const state = { highwater: 700, entryPrice: 539.5, firedLadder: [] };

function regime(composite: number, transitionAxes: string[] = []): RegimeVector {
  return {
    asOf: '2026-07-12T00:00:00Z', composite, regimeLabel: 'RISK_ON',
    transition: transitionAxes.length >= 2, transitionAxes, axes: [],
  };
}

function input(overrides: Partial<PriceGuardPolicyInput> = {}): PriceGuardPolicyInput {
  return { symbol: 'KORU', current: 690, state, ...overrides };
}

describe('price guard policy', () => {
  test('evaluates all four trigger families in a single pure decision', () => {
    const decision = decidePriceGuard(input({
      current: 615,
      previousRegime: regime(0.459),
      regime: regime(0.343, ['asset_flow', 'kr_flow']),
    }));

    expect(decision.triggers.map(trigger => trigger.kind)).toEqual([
      'TRAILING_EXIT', 'CAPSTONE_WARNING',
    ]);
    expect(decision.held).toBe(false);
    expect(decision.triggers.find(trigger => trigger.kind === 'TRAILING_EXIT')?.severity).toBe('critical');
    expect(decision.triggers.find(trigger => trigger.kind === 'LADDER')).toBeUndefined();
  });

  test('suppresses phantom exit_all for unheld watched symbols (held=false)', () => {
    // 미보유 감시종목: entryPrice==highwater==current → exitAll=current → held 게이트 없으면
    // 매 사이클 EXIT_ALL 유령 발사. held:false 면 청산/트림/래더 억제, capstone 만 남는다.
    const phantomState = { highwater: 481.34, entryPrice: 481.34, firedLadder: [] };
    const held = decidePriceGuard(input({ current: 481.34, state: phantomState, held: true }));
    // 보유 취급이면 (버그 재현) EXIT_ALL 트리거가 존재
    expect(held.triggers.some(t => t.kind === 'TRAILING_EXIT')).toBe(true);
    // 미보유면 포지션관리 트리거 전무 → protect 신호로 이어질 critical 없음
    const unheld = decidePriceGuard(input({ current: 481.34, state: phantomState, held: false }));
    expect(unheld.triggers.some(t => t.kind === 'TRAILING_EXIT')).toBe(false);
    expect(unheld.triggers.some(t => t.severity === 'critical')).toBe(false);
    expect(unheld.held).toBe(true);
  });

  test('returns the same result for the same symbol and snapshots', () => {
    const snapshot = input({
      current: 660,
      previousRegime: regime(0.459),
      regime: regime(0.343, ['asset_flow', 'kr_flow']),
    });
    expect(decidePriceGuard(snapshot)).toEqual(decidePriceGuard(snapshot));
  });

  test('warns for RISK_ON to RISK_ON composite collapse with multiple sign flips', () => {
    const decision = decidePriceGuard(input({
      previousRegime: regime(0.459),
      regime: regime(0.343, ['kr_flow', 'asset_flow']),
    }));
    const warning = decision.triggers.find(trigger => trigger.kind === 'CAPSTONE_WARNING');

    expect(warning).toMatchObject({
      symbol: 'KORU', severity: 'warning', held: true, action: 'HOLD_AND_REVIEW',
      compositeDrop: 0.116, transitionAxes: ['asset_flow', 'kr_flow'],
    });
  });

  test('keeps normal movement and exact composite threshold silent', () => {
    const decision = decidePriceGuard(input({
      current: 670,
      state: { ...state, firedLadder: [655] },
      previousRegime: regime(0.459),
      regime: regime(0.359, ['asset_flow', 'kr_flow']),
    }));
    expect(decision.triggers).toEqual([]);
    expect(decision.held).toBe(true);
  });

  test('does not retrigger duplicate ladder levels', () => {
    const decision = decidePriceGuard(input({ current: 700, state: { ...state, firedLadder: [655, 680, 700] } }));
    expect(decision.triggers.some(trigger => trigger.kind === 'LADDER')).toBe(false);
  });

  test('returns a trailing trim without exiting the held position', () => {
    const decision = decidePriceGuard(input({ current: 660 }));
    expect(decision).toMatchObject({ held: true });
    expect(decision.triggers.find(trigger => trigger.kind === 'TRAILING_TRIM')).toMatchObject({
      action: 'TRIM_25', severity: 'warning', held: true,
    });
  });
});
