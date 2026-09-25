// 종목 발굴 단위테스트 — 인메모리(emergence + dig 큐 + 리포트).
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { openBuzzDb } from './store.js';
import { ensureEmergenceTable, recordEmergence, noveltyFromVerdict } from './novelty.js';
import { discoveryCandidates, enqueueForumDiscovery, formatDiscoveryReport, type DiscoveryCandidate } from './discovery.js';

function seedEmergence(db: ReturnType<typeof openBuzzDb>): void {
  ensureEmergenceTable(db);
  // 하이닉스 x8(leading)·마이크론 x4·저ratio x1.5(제외)
  recordEmergence(db, new Date().toISOString(), { ticker: '000660.KO', recent: 11, baseline: 1, ratio: 8, titles: ['하닉 폭등'] }, noveltyFromVerdict('not-found'));
  recordEmergence(db, new Date().toISOString(), { ticker: 'MU', recent: 8, baseline: 2, ratio: 4, titles: ['마이크론 신고가'] }, noveltyFromVerdict('found-external'));
  recordEmergence(db, new Date().toISOString(), { ticker: 'SNDK', recent: 2, baseline: 1.3, ratio: 1.5, titles: ['샌디'] });
}

describe('discoveryCandidates — 급부상 후보', () => {
  test('minRatio 이상·티커별 최신·ratio순', () => {
    const db = openBuzzDb(':memory:');
    seedEmergence(db);
    const c = discoveryCandidates(db, { minRatio: 2.5 });
    expect(c.map(x => x.ticker)).toEqual(['000660.KO', 'MU']); // SNDK(1.5) 제외·ratio 내림차순
    expect(c[0]!.leadLag).toContain('leading');
  });
});

describe('enqueueForumDiscovery — dig_queue 적재', () => {
  test('forum: id·score=ratio*2·dedup', () => {
    const digDb = new Database(':memory:');
    digDb.run(`CREATE TABLE dig_queue(id TEXT PRIMARY KEY, topic TEXT, sector TEXT, score INT, created_at TEXT, status TEXT DEFAULT 'queued')`);
    const cands: DiscoveryCandidate[] = [{ ticker: '000660.KO', ratio: 8, recent: 11, novelty: 0.9, leadLag: 'leading', example: '하닉 폭등' }];
    const n = enqueueForumDiscovery(digDb, cands, '2026-07-10T00:00:00Z');
    expect(n).toBe(1);
    const row = digDb.prepare(`SELECT id, sector, score FROM dig_queue`).get() as { id: string; sector: string; score: number };
    expect(row.id).toBe('forum:000660.KO:2026-07-10');
    expect(row.sector).toBe('000660.KO');
    expect(row.score).toBe(8); // min(8, 16)
    // 재적재 dedup
    expect(enqueueForumDiscovery(digDb, cands, '2026-07-10T00:05:00Z')).toBe(0);
  });
});

describe('formatDiscoveryReport', () => {
  test('급부상·lead/lag·매력도 signal·빈배열 null', () => {
    expect(formatDiscoveryReport([], new Map())).toBeNull();
    const cands: DiscoveryCandidate[] = [{ ticker: '000660.KO', ratio: 8, recent: 11, novelty: 0.9, leadLag: 'leading(뉴스前·SNS선행)', example: '하닉 폭등' }];
    const attract = new Map([['000660.KO', { signal: 'BUY', score: 72.1, asOf: '2026-07-09' }]]);
    const t = formatDiscoveryReport(cands, attract)!;
    expect(t).toContain('000660.KO x8');
    expect(t).toContain('leading');
    expect(t).toContain('매력도 BUY(72.1)');
  });
  test('미채점 종목 표기', () => {
    const t = formatDiscoveryReport([{ ticker: 'XYZ', ratio: 3, recent: 4, novelty: null, leadLag: null, example: null }], new Map([['XYZ', null]]))!;
    expect(t).toContain('매력도 미채점');
  });
});
