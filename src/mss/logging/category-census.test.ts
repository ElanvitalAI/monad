import { describe, expect, test } from 'bun:test';
import { LogStore } from './log-store.js';
import type { LogRecord } from './record.js';

const rec = (category: string, ts: number = 0): { rec: LogRecord; surface: string } => ({
  rec: { ts: new Date(ts).toISOString(), category, event: 'e', level: 'debug' },
  surface: 'test',
});

/**
 * ⛔⭐⭐ 종전엔 「어떤 카테고리가 «실제로» 뜨나」를 묻는 표면이 «없었다».
 * 그래서 `F12`(계측했는데 안 닿는다) 감사를 ***한 카테고리씩 손으로*** 했다.
 */
describe('LogStore.categoryCounts — 실제로 뜬 카테고리 전수', () => {
  test('⭐ 카테고리별 발화 수를 내림차순으로 낸다', () => {
    const store = new LogStore(':memory:');
    store.insertBatch([rec('a.b'), rec('a.b'), rec('a.b'), rec('c.d')]);
    const rows = store.categoryCounts();
    expect(rows[0]).toEqual({ category: 'a.b', count: 3 });
    expect(rows[1]).toEqual({ category: 'c.d', count: 1 });
    store.close();
  });

  test('⭐ 기존과 같은 포괄 시간 창으로 since·until·둘 다·미지정을 집계한다', () => {
    const store = new LogStore(':memory:');
    store.insertBatch([
      rec('before', 1_000),
      rec('inside', 2_000),
      rec('inside', 3_000),
      rec('after', 4_000),
    ]);

    const counts = (query?: { sinceMs?: number; untilMs?: number }): Record<string, number> =>
      Object.fromEntries(store.categoryCounts(query).map(({ category, count }) => [category, count]));
    expect(counts({ sinceMs: 2_000 })).toEqual({ inside: 2, after: 1 });
    expect(counts({ untilMs: 3_000 })).toEqual({ before: 1, inside: 2 });
    expect(counts({ sinceMs: 2_000, untilMs: 3_000 })).toEqual({ inside: 2 });
    expect(counts()).toEqual({ before: 1, inside: 2, after: 1 });
    store.close();
  });

  test('⛔ 빈 스토어는 «빈 목록»이다 — 0을 지어내지 않는다', () => {
    const store = new LogStore(':memory:');
    expect(store.categoryCounts()).toEqual([]);
    store.close();
  });

  test('⛔ «안 뜬» 카테고리는 목록에 «없다» — 그것이 차집합의 근거다', () => {
    const store = new LogStore(':memory:');
    store.insertBatch([rec('seen')]);
    const names = store.categoryCounts().map((r) => r.category);
    expect(names).toContain('seen');
    expect(names).not.toContain('never-fired');
    store.close();
  });
});
