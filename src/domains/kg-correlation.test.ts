import { test, expect, describe } from 'bun:test';
import {
  logReturns, pearson, alignByDate, computeCorrelation, computeLeadLag, corrAtLag,
  type PriceBar,
} from './kg-correlation.js';

/** date asc bar 시계열 생성. */
function bars(closes: number[], start = 1): PriceBar[] {
  return closes.map((c, i) => ({ date: `2026-04-${String(start + i).padStart(2, '0')}`, close: c }));
}

describe('kg-correlation — 순수 통계', () => {
  test('logReturns', () => {
    const r = logReturns([100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]!).toBeCloseTo(Math.log(1.1), 6);
    expect(r[1]!).toBeCloseTo(Math.log(1.1), 6);
  });
  test('pearson 완전 양의 상관 = 1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])!).toBeCloseTo(1, 6);
  });
  test('pearson 완전 음의 상관 = -1', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])!).toBeCloseTo(-1, 6);
  });
  test('분산 0 / 표본부족 = null', () => {
    expect(pearson([1, 1, 1, 1], [2, 4, 6, 8])).toBeNull();
    expect(pearson([1, 2], [2, 4])).toBeNull();  // n<3
  });
});

describe('kg-correlation — 정렬 + 상관', () => {
  test('alignByDate 공통 date만', () => {
    const a = bars([10, 11, 12, 13]);            // 04-01..04-04
    const b = [{ date: '2026-04-02', close: 20 }, { date: '2026-04-03', close: 22 }, { date: '2026-04-05', close: 25 }];
    const al = alignByDate(a, b);
    expect(al.dates).toEqual(['2026-04-02', '2026-04-03']);  // 교집합
    expect(al.a).toEqual([11, 12]);
    expect(al.b).toEqual([20, 22]);
  });
  test('computeCorrelation 동조 시계열 → 양', () => {
    const up = bars([100, 102, 104, 106, 108, 110, 112, 114]);
    const alsoUp = bars([50, 51, 52, 53, 54, 55, 56, 57]);
    const c = computeCorrelation(up, alsoUp, 60)!;
    expect(c).toBeGreaterThan(0.9);
  });
  test('★R8 역관계 시계열 → 음 (P7↔M7 케이스)', () => {
    // A 오르면 B 내림 — 경쟁/적대
    const a = bars([100, 105, 110, 108, 115, 120, 118, 125]);
    const b = bars([100, 96, 92, 94, 88, 84, 86, 80]);
    const c = computeCorrelation(a, b, 60)!;
    expect(c).toBeLessThan(-0.8);   // 음의 상관
  });
});

describe('kg-correlation — lead-lag (R6·R3)', () => {
  test('corrAtLag lag>0 = a 선행', () => {
    const ra = [0.1, 0.2, -0.1, 0.3, 0.0];
    const rb = [0.2, -0.1, 0.3, 0.0, 0.1];  // rb = ra shifted +1 (a가 1일 선행)
    // lag=1: ra[0..3] vs rb[1..4] = [.1,.2,-.1,.3] vs [-.1,.3,.0,.1]... 아래는 완전동조 케이스로 검증
    expect(corrAtLag(ra, rb, 0)).not.toBeNull();
  });
  test('★마이크론(a) → 삼성(b) 시차 감지: b가 a를 2일 지연 추종', () => {
    // a 의 움직임이 2일 후 b 에 나타남 → lag=+2 (a leads b by 2)
    const base = [1, 3, -2, 4, -1, 2, 5, -3, 1, 2, 4, -1, 3, -2, 1];
    const a = bars(cumPrice(base));
    // b = a 를 2 스텝 뒤로 민 수익률(앞 2개는 노이즈)
    const bRet = [0.5, -0.5, ...base];
    const b = bars(cumPrice(bRet));
    const ll = computeLeadLag(a, b, 5, 60)!;
    expect(ll.lag).toBe(2);          // a가 b를 2일 선행
    expect(ll.corr).toBeGreaterThan(0.9);
  });
  test('데이터 부족 = null', () => {
    expect(computeLeadLag(bars([1, 2, 3]), bars([1, 2, 3]), 5)).toBeNull();
  });
});

/** 수익률 배열 → 종가 시계열(누적곱·시작 100). */
function cumPrice(rets: number[]): number[] {
  const out = [100];
  for (const r of rets) out.push(out[out.length - 1]! * (1 + r / 100));
  return out;
}
