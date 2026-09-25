import { test, expect, describe } from 'bun:test';
import { summarizeFinvizMap, formatFinvizMap, fetchFinvizMapNodes, renderFinvizMap } from './finviz-map.js';

const nodes = { NVDA: 0.71, AVGO: -0.83, MU: -4.71, XOM: 3.85, INTC: -9.66, OXY: 5.88, CTSH: 6.21, AAPL: -0.64 };

describe('summarizeFinvizMap', () => {
  test('breadth + 톱/워스트 무버', () => {
    const s = summarizeFinvizMap(nodes)!;
    expect(s.total).toBe(8);
    expect(s.up).toBe(4);          // NVDA·XOM·OXY·CTSH
    expect(s.down).toBe(4);        // AVGO·MU·INTC·AAPL
    expect(s.top[0]).toEqual({ ticker: 'CTSH', perf: 6.21 });   // 최고
    expect(s.bottom[0]).toEqual({ ticker: 'INTC', perf: -9.66 }); // 최저
  });

  test('빈 입력 → null', () => {
    expect(summarizeFinvizMap({})).toBeNull();
    expect(summarizeFinvizMap({ X: NaN as unknown as number })).toBeNull();
  });
});

describe('formatFinvizMap', () => {
  test('섹션 텍스트(breadth·강세·약세)', () => {
    const s = summarizeFinvizMap(nodes)!;
    const out = formatFinvizMap(s);
    expect(out).toContain('🗺️ *S&P 히트맵* (8종)');
    expect(out).toContain('CTSH +6.2%');
    expect(out).toContain('INTC -9.7%');
    expect(out).toMatch(/breadth \d+↑\/\d+↓/);
  });
});

describe('fetch/render (주입 fetcher)', () => {
  test('fetcher 성공 → nodes', async () => {
    const n = await fetchFinvizMapNodes(async () => nodes);
    expect(n).toEqual(nodes);
  });
  test('fetcher 실패(throw) → null · render 빈 문자열', async () => {
    expect(await fetchFinvizMapNodes(async () => { throw new Error('block'); })).toBeNull();
    expect(await renderFinvizMap(async () => { throw new Error('block'); })).toBe('');
    expect(await renderFinvizMap(async () => null)).toBe('');
  });
  test('render 성공 → 섹션', async () => {
    expect(await renderFinvizMap(async () => nodes)).toContain('S&P 히트맵');
  });
});
