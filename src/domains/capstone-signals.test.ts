import { test, expect, describe } from 'bun:test';
import {
  pctChange, mean, sampleStd, clip,
  calcA, calcB, calcR3, calcD, calcE, decideTarget, nextDay,
  computeAbcdeSignals,
} from './capstone-signals.js';

describe('pandas/numpy 재현 헬퍼', () => {
  test('pctChange', () => {
    const r = pctChange([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
    expect(pctChange([50])).toEqual([]);
  });
  test('mean', () => { expect(mean([1, 2, 3, 4])).toBe(2.5); expect(mean([])).toBe(0); });
  test('sampleStd (ddof=1)', () => {
    // std([1,2,3,4]) sample = sqrt(sum(sq)/(n-1)) = sqrt(5/3) ≈ 1.2909944
    expect(sampleStd([1, 2, 3, 4])).toBeCloseTo(1.2909944, 6);
    expect(sampleStd([5])).toBe(0);
  });
  test('clip', () => {
    expect(clip(-0.1, -0.07, -0.05)).toBe(-0.07);
    expect(clip(-0.02, -0.07, -0.05)).toBe(-0.05);
    expect(clip(-0.06, -0.07, -0.05)).toBe(-0.06);
  });
});

describe('A — 원화약세', () => {
  test('last > ma60*1.02 → bear', () => {
    const flat = Array(60).fill(1000);
    expect(calcA([...flat.slice(0, 59), 1000])).toBe(false);   // == ma
    expect(calcA([...flat.slice(0, 59), 1030])).toBe(true);    // +3% > +2%
    expect(calcA([...flat.slice(0, 59), 1015])).toBe(false);   // +1.5% < +2%
  });
  test('데이터 <60 → false(보수)', () => expect(calcA(Array(30).fill(1000))).toBe(false));
});

describe('B — 동적 손실깊이', () => {
  test('완만한 하락은 vol 임계 안 넘음 → bull', () => {
    const c = Array.from({ length: 260 }, (_, i) => 1000 - i * 0.1); // 아주 완만
    const r = calcB(c);
    expect(r.threshold).toBeLessThanOrEqual(-0.05);
    expect(r.threshold).toBeGreaterThanOrEqual(-0.07);
    expect(r.bear).toBe(false);
  });
  test('252d 고점比 대폭락 → bear, dd 음수', () => {
    const c = [...Array(252).fill(1000), 800]; // 고점 1000 → 800 = -20%
    const r = calcB(c);
    expect(r.dd).toBeCloseTo(-0.2, 6);
    expect(r.bear).toBe(true);
  });
});

describe('C — R3 5일 신고가', () => {
  test('직전 5일 최고 이상 → true', () => {
    expect(calcR3([10, 11, 12, 11, 10, 12])).toBe(true);  // 오늘 12 >= max(11,12,11,10)=12
    expect(calcR3([10, 11, 12, 13, 14, 13])).toBe(false); // 13 < 14
  });
  test('데이터 부족 → false', () => expect(calcR3([1, 2, 3])).toBe(false));
});

describe('D — PSD K≥2', () => {
  test('SOXL만 -16% (K=1) → 미발동', () => {
    const r = calcD([100, 84], [16, 16], [100, 99], [100, 99]);
    expect(r.k).toBe(1);
    expect(r.fire).toBe(false);
  });
  test('SOXL -16% + VIX +25% (K=2) → 발동', () => {
    const r = calcD([100, 84], [16, 20], [100, 99], [100, 99]);
    expect(r.k).toBe(2);
    expect(r.fire).toBe(true);
  });
  test('SOXL-16 SMH-6 TSM-7 (K=3) → 발동', () => {
    const r = calcD([100, 84], [16, 16], [100, 94], [100, 93]);
    expect(r.k).toBe(3);
    expect(r.fire).toBe(true);
  });
});

describe('E — 충격반등 슬리브', () => {
  test('데이터 부족 → 미발동', () => {
    expect(calcE([1, 2, 3], Array(200).fill(1)).fire).toBe(false);
  });
  test('SMH 약세(200MA 아래)면 vz 깊어도 게이트 OFF', () => {
    const soxl = [...Array(30).fill(100), 50]; // 급락
    const smh = Array.from({ length: 201 }, (_, i) => 200 - i); // 우하향 → last < mean
    expect(calcE(soxl, smh).smhBull).toBe(false);
    expect(calcE(soxl, smh).fire).toBe(false);
  });
});

describe('decideTarget — 국면 결정 (auto_trade 포팅)', () => {
  const noHedge = { dHedgeActive: false, dHedgeUntil: null };
  test('bull → LONG_100', () => {
    expect(decideTarget({ a: false, b: false, r3: false, dFire: false }, noHedge, '2026-07-05').target).toBe('LONG_100');
  });
  test('bear 비회복 → CASH_100', () => {
    expect(decideTarget({ a: false, b: true, r3: false, dFire: false }, noHedge, '2026-07-05').target).toBe('CASH_100');
  });
  test('bear + R3 회복 → LONG_100', () => {
    expect(decideTarget({ a: false, b: true, r3: true, dFire: false }, noHedge, '2026-07-05').target).toBe('LONG_100');
  });
  test('D 발동 → HEDGE_1D + hedge state 세팅(익일까지)', () => {
    const r = decideTarget({ a: false, b: false, r3: false, dFire: true }, noHedge, '2026-07-05');
    expect(r.target).toBe('HEDGE_1D');
    expect(r.nextState.dHedgeActive).toBe(true);
    expect(r.nextState.dHedgeUntil).toBe('2026-07-06');
  });
  test('hedge 진행중(오늘<=until) → HEDGE_HOLD', () => {
    const r = decideTarget({ a: false, b: false, r3: false, dFire: false },
      { dHedgeActive: true, dHedgeUntil: '2026-07-06' }, '2026-07-06');
    expect(r.target).toBe('HEDGE_HOLD');
  });
  test('hedge 만료(오늘>until) → 리셋 후 정상 국면', () => {
    const r = decideTarget({ a: false, b: false, r3: false, dFire: false },
      { dHedgeActive: true, dHedgeUntil: '2026-07-06' }, '2026-07-07');
    expect(r.target).toBe('LONG_100');
    expect(r.nextState.dHedgeActive).toBe(false);
  });
  test('D 우선 — bear여도 dFire면 HEDGE', () => {
    expect(decideTarget({ a: true, b: true, r3: false, dFire: true }, noHedge, '2026-07-05').target).toBe('HEDGE_1D');
  });
});

describe('nextDay', () => {
  test('월경계·일반', () => {
    expect(nextDay('2026-07-05')).toBe('2026-07-06');
    expect(nextDay('2026-07-31')).toBe('2026-08-01');
  });
});

describe('computeAbcdeSignals — 실시간 소스 우선순위(토스>EODHD) + 세션 게이트', () => {
  const eod = (sym: string): number[] => {
    if (sym === 'SOXL.US') return [...Array(260).fill(100), 100]; // 전일比 0%(미발동)
    if (sym === 'SMH.US') return [...Array(260).fill(100), 100];
    if (sym === 'TSM.US') return [100, 100];
    if (sym === 'VIX.INDX') return [16, 16];
    if (sym === '005930.KO') return Array(260).fill(1000);         // 낙폭 0 → bull
    if (sym === 'USDKRW.FOREX') return Array(60).fill(1300);
    return [];
  };
  // EODHD quote(fallback): SOXL/SMH 충격.
  const eodhdQuote = (sym: string) => {
    if (sym === 'SOXL.US') return { prevClose: 100, close: 84 };   // -16%
    if (sym === 'SMH.US') return { prevClose: 100, close: 94 };    // -6%
    if (sym === '005930.KO') return { prevClose: 1000, close: 780 };
    return null;
  };
  // 토스 quote(primary): 동일 충격(prevClose 포함).
  const tossShock = (sym: string) => {
    if (sym === 'SOXL.US') return { last: 84, prevClose: 100 };    // -16%
    if (sym === 'SMH.US') return { last: 94, prevClose: 100 };     // -6%
    if (sym === '005930.KO') return { last: 780, prevClose: 1000 };
    return null;
  };

  test('gate 미주입 → 전부 EOD', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, {}, tossShock);
    expect(s.dLive).toBe(false);
    expect(s.bLive).toBe(false);
    expect(s.dDetail.live).toBe('EOD');
  });

  test('US ET 세션 → 토스 우선(dSrc=토스)·D 발동. EODHD보다 토스', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, { usEtLive: true }, tossShock);
    expect(s.dLive).toBe(true);
    expect(s.dDetail.live).toBe('토스');
    expect(s.dK).toBe(2);
    expect(s.dFire).toBe(true);
  });

  test('US 주간거래(overnight)만 → 토스로 D 발동', () => {
    const s = computeAbcdeSignals(eod, undefined, { usOvernight: true }, tossShock);
    expect(s.dLive).toBe(true);
    expect(s.dDetail.live).toBe('토스');
    expect(s.dFire).toBe(true);
  });

  test('토스 실패 + US ET 세션 → EODHD fallback(dSrc=EODHD)', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, { usEtLive: true }, () => null);
    expect(s.dLive).toBe(true);
    expect(s.dDetail.live).toBe('EODHD');
    expect(s.dFire).toBe(true);
  });

  test('US 전 세션 마감 → EOD(미발동)', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, { krNxt: true }, tossShock);
    expect(s.dLive).toBe(false);
    expect(s.dDetail.live).toBe('EOD');
  });

  test('KR NXT(krNxt) → 토스로 B 실시간(삼성 -22%) → bear', () => {
    const s = computeAbcdeSignals(eod, undefined, { krNxt: true }, tossShock);
    expect(s.bLive).toBe(true);
    expect(s.b).toBe(true);
  });

  test('KR 정규장 + 토스 실패 → EODHD fallback로 B', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, { krRegular: true }, () => null);
    expect(s.bLive).toBe(true);
    expect(s.b).toBe(true);
  });

  test('KR 마감 → B는 EOD(낙폭 0) → bull', () => {
    const s = computeAbcdeSignals(eod, eodhdQuote, { usEtLive: true }, tossShock);
    expect(s.bLive).toBe(false);
    expect(s.b).toBe(false);
  });

  test('라이브여도 전 소스 실패 → EOD fail-soft', () => {
    const s = computeAbcdeSignals(eod, () => null, { usEtLive: true, krRegular: true }, () => null);
    expect(s.dLive).toBe(false);
    expect(s.bLive).toBe(false);
  });
});
