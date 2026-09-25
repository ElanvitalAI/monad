import { test, expect, describe } from 'bun:test';
import { screenerPreset, formatScreenerRows, parseScreenerJson, type ScreenerRow } from './screener-presets.js';

describe('screenerPreset', () => {
  test('4 프리셋 필터+정렬', () => {
    expect(screenerPreset('us-gainers')?.desc).toBe(true);
    expect(screenerPreset('us-losers')?.desc).toBe(false);        // 하락 = 오름차순
    expect(screenerPreset('us-momentum')?.sortKey).toBe('refund_5d_p');
    expect(screenerPreset('us-value')?.filters).toContain('dividend_yield');
    expect(screenerPreset('nope')).toBeNull();
  });
});

const rows: ScreenerRow[] = [
  { code: 'AAA', name: 'Alpha', refund_1d_p: 5.2, market_capitalization: 2e10, sector: 'Tech' },
  { code: 'BBB', name: 'Beta', refund_1d_p: 8.1, market_capitalization: 1e10, sector: 'Energy' },
  { code: 'CCC', name: 'Gamma', refund_1d_p: 3.5, market_capitalization: 3e10, sector: 'Health' },
];

describe('formatScreenerRows', () => {
  test('desc 정렬 + 상위 N', () => {
    const out = formatScreenerRows(rows, 'refund_1d_p', true, 2, 'US 상승');
    expect(out).toContain('[US 상승] 상위 2');
    const lines = out.split('\n');
    expect(lines[1]).toContain('BBB');    // 8.1 최상위
    expect(lines[2]).toContain('AAA');    // 5.2
    expect(out).not.toContain('CCC');     // limit 2
  });
  test('code 없는 행 제외 · 빈 → 안내', () => {
    expect(formatScreenerRows([{ name: 'x' }], 'refund_1d_p', true, 5, 'L')).toContain('매치 없음');
  });
});

describe('parseScreenerJson', () => {
  test('배너 속 JSON 배열 추출', () => {
    const out = 'OmniMarket banner\n===\n[{"code":"AAA","refund_1d_p":5.2}]\n===';
    const r = parseScreenerJson(out);
    expect(r.length).toBe(1);
    expect(r[0]!.code).toBe('AAA');
  });
  test('JSON 없으면 빈 배열', () => {
    expect(parseScreenerJson('no json here')).toEqual([]);
  });
});
