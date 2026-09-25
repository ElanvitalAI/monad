import { test, expect, describe } from 'bun:test';
import { openPriceHistoryDb, recordPrice, computeMomentum, pruneOldPrices } from './price-history.js';

const T0 = Date.parse('2026-07-15T08:00:00.000Z');

describe('computeMomentum (1h 대비)', () => {
  test('1h 전 대비 급락/급등 % 계산', () => {
    const db = openPriceHistoryDb(':memory:');
    try {
      // 1h 전(07:00) 500, 현재(08:00) 470 → -6%.
      recordPrice(db, 'KORU', 500, new Date(T0 - 60 * 60_000).toISOString());
      const m = computeMomentum(db, 'KORU', T0, 470, 60);
      expect(m).not.toBeNull();
      expect(m!.pct).toBeCloseTo(-6, 3);
      expect(m!.refPrice).toBe(500);
    } finally { db.close(); }
  });

  test('급등도 계산(양수)', () => {
    const db = openPriceHistoryDb(':memory:');
    try {
      recordPrice(db, 'KORU', 480, new Date(T0 - 55 * 60_000).toISOString());
      const m = computeMomentum(db, 'KORU', T0, 528, 60);
      expect(m!.pct).toBeCloseTo(10, 2);   // +10%
    } finally { db.close(); }
  });

  test('이력 부족(허용창 내 기준 없음) → null(fail-soft)', () => {
    const db = openPriceHistoryDb(':memory:');
    try {
      recordPrice(db, 'KORU', 500, new Date(T0 - 5 * 60_000).toISOString()); // 5분전만 → 1h 창 밖
      expect(computeMomentum(db, 'KORU', T0, 470, 60)).toBeNull();
    } finally { db.close(); }
  });

  test('prune — 오래된 행 제거', () => {
    const db = openPriceHistoryDb(':memory:');
    try {
      recordPrice(db, 'KORU', 500, new Date(T0 - 50 * 3_600_000).toISOString()); // 50h 전
      recordPrice(db, 'KORU', 510, new Date(T0 - 1 * 3_600_000).toISOString());  // 1h 전
      const removed = pruneOldPrices(db, T0, 48);
      expect(removed).toBe(1);
    } finally { db.close(); }
  });
});
