import { test, expect, describe } from 'bun:test';
import { openMacroDb, recordMacroSnapshot, recentMacro, macroTrend, formatMacroTrend } from './macro-store.js';

const db = () => openMacroDb(':memory:');

describe('macro-store', () => {
  test('스냅샷 upsert + 최근 조회(같은 날짜 덮어씀)', () => {
    const d = db();
    recordMacroSnapshot(d, { asOf: '2026-07-06', usdkrw: 1520, ust10y: 4.4 });
    recordMacroSnapshot(d, { asOf: '2026-07-07', usdkrw: 1512, ust10y: 4.48 });
    recordMacroSnapshot(d, { asOf: '2026-07-07', usdkrw: 1511, ust10y: 4.49 }); // 덮어씀
    const rows = recentMacro(d, 10);
    expect(rows.length).toBe(2);                 // 2일(중복 아님)
    expect(rows[0]!.as_of).toBe('2026-07-07');   // 최신순
    expect(rows[0]!.usdkrw).toBe(1511);          // 덮어쓴 값
  });

  test('macroTrend — 최신 vs N일 전 변화', () => {
    const d = db();
    recordMacroSnapshot(d, { asOf: '2026-07-01', usdkrw: 1500, ust10y: 4.30 });
    recordMacroSnapshot(d, { asOf: '2026-07-07', usdkrw: 1512, ust10y: 4.48 });
    const t = macroTrend(d, 5);
    expect(t.usdkrwChange).toBeCloseTo(12, 1);   // 1512-1500
    expect(t.ust10yChange).toBeCloseTo(0.18, 2); // 4.48-4.30
  });

  test('데이터 1개 → 추세 없음', () => {
    const d = db();
    recordMacroSnapshot(d, { asOf: '2026-07-07', usdkrw: 1512 });
    expect(macroTrend(d, 5).samples).toBe(1);
    expect(formatMacroTrend(macroTrend(d, 5))).toBe('');
  });
});

describe('formatMacroTrend', () => {
  test('유의 변화만 표시(미10년 급등·환율 급변)', () => {
    const s = formatMacroTrend({ days: 5, ust10yChange: 0.18, usdkrwChange: 12, samples: 3 });
    expect(s).toContain('미10년 +0.18%p');
    expect(s).toContain('원/달러 +12원');
  });
  test('미미한 변화 → 빈 문자열', () => {
    expect(formatMacroTrend({ days: 5, ust10yChange: 0.01, usdkrwChange: 1, samples: 3 })).toBe('');
  });
});
