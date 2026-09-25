import { test, expect, describe } from 'bun:test';
import {
  slotAWeights, slotACapital, slotBCapital, slotATargets, slotBTargets, computeDeltaOrders, normSym,
} from './trade-strategy.js';
import { DEFAULT_MANDATE, type TradeMandate } from './trade-mandate.js';

const M: TradeMandate = { ...DEFAULT_MANDATE, totalCapitalKrw: 90_000_000 }; // 9천만·2:1 → A 6천만·B 3천만

describe('슬롯 자본 배분 (2:1)', () => {
  test('A=2/3 · B=1/3', () => {
    expect(slotACapital(M)).toBe(60_000_000);
    expect(slotBCapital(M)).toBe(30_000_000);
  });
});

describe('slotAWeights — 국면 매핑', () => {
  test('BEAR_CASH→현금 · BULL_1X→본주 · PSD→인버스헤지', () => {
    expect(slotAWeights('BEAR_CASH')).toEqual({ stock: 0, lev2x: 0, inverse2x: 0, cash: 1 });
    expect(slotAWeights('BULL_1X').stock).toBe(1);
    expect(slotAWeights('PSD_-1X').inverse2x).toBe(0.5);
    expect(slotAWeights('알수없음').cash).toBe(1); // fail-safe 현금
  });
});

describe('slotATargets', () => {
  test('BEAR_CASH → leg 없음(현금 100%)', () => {
    expect(slotATargets(M, 'BEAR_CASH')).toEqual([]);
  });
  test('BULL_1X → 본주 leg = A자본', () => {
    const legs = slotATargets(M, 'BULL_1X');
    expect(legs).toHaveLength(1);
    expect(legs[0]!.symbol).toBe('005930');
    expect(legs[0]!.targetKrw).toBe(60_000_000);
  });
});

describe('slotBTargets — 과도폭락 조건부', () => {
  test('평시(entered=false) → 현금(leg 없음)', () => {
    expect(slotBTargets(M, { entered: false })).toEqual([]);
  });
  test('진입 시 심볼별 target', () => {
    const legs = slotBTargets(M, { entered: true, targetKrwBySymbol: { '122630': 20_000_000, KORU: 10_000_000 } });
    expect(legs).toHaveLength(2);
  });
});

describe('computeDeltaOrders', () => {
  test('BEAR_CASH — 삼성 보유분 전량 매도(target 0)', () => {
    const orders = computeDeltaOrders([], [{ symbol: '005930', shares: 200, price: 62_000 }], { '005930': 62_000 });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.side).toBe('sell');
    expect(orders[0]!.qty).toBe(200);
  });
  test('BULL — 목표까지 매수', () => {
    const legs = slotATargets(M, 'BULL_1X'); // 6천만 본주
    const orders = computeDeltaOrders(legs, [], { '005930': 62_000 });
    expect(orders[0]!.side).toBe('buy');
    expect(orders[0]!.qty).toBe(Math.floor(60_000_000 / 62_000));
  });
  test('소액 미만·가격없음 스킵', () => {
    expect(computeDeltaOrders([{ symbol: '005930', role: 'stock', slot: 'A', targetKrw: 10_000 }], [], { '005930': 62_000 })).toEqual([]);
    expect(computeDeltaOrders([{ symbol: 'X', role: 'r', slot: 'A', targetKrw: 1_000_000 }], [], {})).toEqual([]);
  });
});

describe('normSym', () => {
  test('접미사 제거', () => {
    expect(normSym('005930.KO')).toBe('005930');
    expect(normSym('KORU.US')).toBe('KORU');
  });
});
