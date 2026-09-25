// novelty(emergence + lead/lag) 단위테스트 — 인메모리 DB.
import { describe, test, expect } from 'bun:test';
import { openBuzzDb } from './store.js';
import { emergingTickers, noveltyFromVerdict, ensureEmergenceTable, recordEmergence } from './novelty.js';

// buzz_posts 에 시각별 티커 글을 심는다(ts 조작).
function seed(db: ReturnType<typeof openBuzzDb>, rows: Array<{ id: string; ticker: string; agoHours: number; title?: string }>): void {
  const ins = db.prepare(`INSERT INTO buzz_posts(id, ts, fetch_ts, forum, title, tickers) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minutes'), 'fmkorea', ?, ?)`);
  for (const r of rows) ins.run(r.id, `-${r.agoHours * 60} minutes`, r.title ?? `t-${r.id}`, r.ticker);
}

describe('emergingTickers — 급부상 감지', () => {
  test('최근 급증 티커만 포착(기준창 대비 2배+)', () => {
    const db = openBuzzDb(':memory:');
    // NVDA: 최근 2h 에 4건, 기준창(2~24h)엔 1건 → 급증
    seed(db, [
      { id: 'n1', ticker: 'NVDA', agoHours: 0.2 }, { id: 'n2', ticker: 'NVDA', agoHours: 0.5 },
      { id: 'n3', ticker: 'NVDA', agoHours: 1.0 }, { id: 'n4', ticker: 'NVDA', agoHours: 1.5 },
      { id: 'n5', ticker: 'NVDA', agoHours: 10 },
      // MU: 최근 1건뿐(minRecent 미달)
      { id: 'm1', ticker: 'MU', agoHours: 0.3 },
      // 삼성: 꾸준(최근 3, 기준창 20) → 급증 아님
      { id: 's1', ticker: '005930.KO', agoHours: 0.2 }, { id: 's2', ticker: '005930.KO', agoHours: 0.6 }, { id: 's3', ticker: '005930.KO', agoHours: 1.1 },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `sb${i}`, ticker: '005930.KO', agoHours: 3 + i })),
    ]);
    const em = emergingTickers(db, { recentHours: 2, baselineHours: 24, minRecent: 3, minRatio: 2 });
    const tickers = em.map(e => e.ticker);
    expect(tickers).toContain('NVDA');       // 급증
    expect(tickers).not.toContain('MU');     // minRecent 미달
    expect(tickers).not.toContain('005930.KO'); // 꾸준(급증 아님)
    expect(em[0]!.recent).toBe(4);
  });

  test('티커 없으면 빈 배열', () => {
    const db = openBuzzDb(':memory:');
    expect(emergingTickers(db)).toEqual([]);
  });
});

describe('noveltyFromVerdict — lead/lag 매핑', () => {
  test('not-found=leading(고신선)·found-external=lagging·found-internal=기보고', () => {
    expect(noveltyFromVerdict('not-found').novelty).toBeGreaterThan(0.8);
    expect(noveltyFromVerdict('found-external').novelty).toBeLessThan(0.5);
    expect(noveltyFromVerdict('found-internal').novelty).toBeLessThan(0.2);
    expect(noveltyFromVerdict('not-found').label).toContain('leading');
  });
});

describe('ticker_emergence 적재', () => {
  test('recordEmergence 저장', () => {
    const db = openBuzzDb(':memory:');
    ensureEmergenceTable(db);
    recordEmergence(db, '2026-07-10T00:00:00Z', { ticker: 'NVDA', recent: 4, baseline: 0.5, ratio: 8, titles: ['엔비디아 폭등'] }, noveltyFromVerdict('not-found'));
    const row = db.prepare(`SELECT * FROM ticker_emergence WHERE ticker='NVDA'`).get() as Record<string, unknown>;
    expect(row.recent).toBe(4);
    expect(row.lead_lag).toContain('leading');
  });
});
