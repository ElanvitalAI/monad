import { test, expect, describe } from 'bun:test';
import {
  FIXED_WATCH_TARGETS,
  normalizeSymbol,
  buildTargetSet,
  runPriceGuardCycle,
  type HoldingMeta,
  type QuoteResult,
  type PriceGuardCycleDeps,
} from './price-guard-cycle.js';
import type { RegimeVector } from '../src/domains/regime-synth.js';

const quote = (close: number, prev = close): QuoteResult => ({
  close, changePct: 0, high: close, previousClose: prev,
});

const regimeVec = (composite: number, transitionAxes: string[] = []): RegimeVector => ({
  axes: [], composite, regimeLabel: 'NEUTRAL', transition: transitionAxes.length > 0,
  transitionAxes, asOf: '2026-07-11T00:00:00.000Z',
});

describe('normalizeSymbol', () => {
  test('trims and uppercases', () => {
    expect(normalizeSymbol('  koru ')).toBe('KORU');
    expect(normalizeSymbol('0193w0')).toBe('0193W0');
  });
});

describe('buildTargetSet — acceptance #1: 정규화된 단일 심볼 집합', () => {
  test('고정 감시 대상 + 보유자산이 하나의 정규화된 집합으로 합쳐진다', () => {
    const holdings: HoldingMeta[] = [
      { symbol: 'aapl', shares: 10 }, // 동적 보유(대소문자 정규화)
      { symbol: '005930', shares: 200, entryPrice: 309125, highwater: 320000 }, // 고정과 겹침
    ];
    const targets = buildTargetSet(FIXED_WATCH_TARGETS, holdings);
    const symbols = targets.map(t => t.symbol);

    // 고정 5종 + 동적 1종(AAPL). 005930 은 중복 제거.
    expect(symbols).toContain('005930');
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('KORU');
    // 중복 없음.
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols.length).toBe(6);

    // 겹친 심볼은 보유 메타가 결합된다.
    const sam = targets.find(t => t.symbol === '005930')!;
    expect(sam.held).toBe(true);
    expect(sam.shares).toBe(200);
    expect(sam.holding?.entryPrice).toBe(309125);
  });

  test('중복 정규화 심볼(같은 심볼 다른 표기)은 한 엔트리로 병합', () => {
    const targets = buildTargetSet(['KORU', ' koru ', 'Koru'], []);
    expect(targets.length).toBe(1);
    expect(targets[0].symbol).toBe('KORU');
  });
});

describe('runPriceGuardCycle — acceptance #2: 심볼별 공급자 호출 정확히 1회', () => {
  test('같은 심볼이 고정+보유에 중복돼도 시세 호출은 사이클당 1회', () => {
    const calls: string[] = [];
    const deps: PriceGuardCycleDeps = {
      quote: (s) => { calls.push(s); return quote(100); },
      latestRegime: () => null,
      now: () => 'T0',
    };
    const holdings: HoldingMeta[] = [{ symbol: 'KORU', shares: 5 }, { symbol: '005930', shares: 200 }];
    const result = runPriceGuardCycle(deps, holdings);

    // 각 심볼 정확히 1회.
    for (const symbol of Object.keys(result.quoteCallCount)) {
      expect(result.quoteCallCount[symbol]).toBe(1);
    }
    // 실제 호출 리스트에도 중복 없음.
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls).toContain('KORU');
  });
});

describe('runPriceGuardCycle — acceptance #3: 스냅샷 필드 완전성', () => {
  test('스냅샷에 가격·기준가·timestamp·보유여부·regime·legacy state 포함', () => {
    const deps: PriceGuardCycleDeps = {
      quote: () => quote(280, 300),
      latestRegime: () => regimeVec(0.2),
      previousRegime: () => regimeVec(0.5),
      now: () => '2026-07-11T09:00:00.000Z',
    };
    const holdings: HoldingMeta[] = [
      { symbol: '005930', shares: 200, entryPrice: 250, highwater: 320, firedLadder: [1] },
    ];
    const result = runPriceGuardCycle(deps, holdings, ['005930']);
    const snap = result.snapshots.find(s => s.symbol === '005930')!;

    expect(snap.price).toBe(280);
    expect(snap.referencePrice).toBe(300);
    expect(snap.timestamp).toBe('2026-07-11T09:00:00.000Z');
    expect(snap.held).toBe(true);
    expect(snap.state).toEqual({ highwater: 320, entryPrice: 250, firedLadder: [1] });
    expect(snap.regime?.composite).toBe(0.2);
    expect(snap.previousRegime?.composite).toBe(0.5);
    // 정책 판정이 실제로 생성됐다.
    expect(result.decisions.some(d => d.symbol === '005930')).toBe(true);
  });

  test('미보유 심볼은 현재가 기준 보수적 legacy state', () => {
    const deps: PriceGuardCycleDeps = {
      quote: () => quote(50),
      latestRegime: () => null,
      now: () => 'T0',
    };
    const result = runPriceGuardCycle(deps, [], ['KORU']);
    const snap = result.snapshots.find(s => s.symbol === 'KORU')!;
    expect(snap.held).toBe(false);
    expect(snap.state).toEqual({ highwater: 50, entryPrice: 50, firedLadder: [] });
  });
});

describe('runPriceGuardCycle — acceptance #4: 심볼별 오류 격리', () => {
  test('일부 심볼 시세 실패해도 나머지 판정은 계속된다', () => {
    const deps: PriceGuardCycleDeps = {
      quote: (s) => {
        if (s === 'KORU') return null; // 수집 실패
        if (s === '0193W0') throw new Error('provider timeout'); // 예외 격리
        return quote(100);
      },
      latestRegime: () => null,
      now: () => 'T0',
    };
    const result = runPriceGuardCycle(deps, [], ['005930', 'KORU', '0193W0', '122630']);

    // 실패 2건이 구조화 오류로 격리.
    const koruErr = result.errors.find(e => e.symbol === 'KORU');
    const warrantErr = result.errors.find(e => e.symbol === '0193W0');
    expect(koruErr?.stage).toBe('quote');
    expect(warrantErr?.stage).toBe('unknown');
    expect(warrantErr?.error).toContain('provider timeout');

    // 정상 심볼 판정은 중단되지 않는다.
    const ok = result.snapshots.map(s => s.symbol);
    expect(ok).toContain('005930');
    expect(ok).toContain('122630');
    expect(result.decisions.length).toBe(2);
  });
});
