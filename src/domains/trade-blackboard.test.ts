import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { openTradeBlackboardDb, submitIntent, latestIntents, pruneIntents } from './trade-blackboard.js';
import { internalSource } from './agent-source.js';
import type { TargetLeg } from './trade-strategy.js';

function memDb(): Database { return openTradeBlackboardDb(':memory:'); }
const legsA: TargetLeg[] = [{ symbol: '005930', role: 'stock', slot: 'A', targetKrw: 40_000_000 }];
const legsB: TargetLeg[] = [{ symbol: '122630', role: 'leverage', slot: 'B', targetKrw: 20_000_000 }];

describe('trade-blackboard — submit/latest', () => {
  test('submitIntent — provenance(내부 trust 1.0) 스탬프', () => {
    const db = memDb();
    const e = submitIntent(db, internalSource('contract:samsung-capstone', '삼성 캡스톤'), {
      contract: '삼성 캡스톤', targets: legsA, regime: 'BEAR_CASH', rationale: '방어',
      now: new Date('2026-07-10T00:00:00Z'),
    });
    expect(e.origin).toBe('internal');
    expect(e.trust).toBe(1.0);
    expect(e.targets).toEqual(legsA);
    expect(e.ts).toBe('2026-07-10T00:00:00.000Z');
  });

  test('latestIntents — 소스별 최신 1건 수집', () => {
    const db = memDb();
    const capstone = internalSource('contract:samsung-capstone');
    const lev = internalSource('contract:korea-leverage');
    submitIntent(db, capstone, { targets: legsA, now: new Date('2026-07-10T00:00:00Z') });
    submitIntent(db, capstone, { targets: [], now: new Date('2026-07-10T00:10:00Z') }); // 최신(청산)
    submitIntent(db, lev, { targets: legsB, now: new Date('2026-07-10T00:05:00Z') });
    const latest = latestIntents(db);
    expect(latest.length).toBe(2); // 소스 2개
    const cap = latest.find(e => e.sourceId === 'contract:samsung-capstone')!;
    expect(cap.targets).toEqual([]); // 최신 = 청산
    const l = latest.find(e => e.sourceId === 'contract:korea-leverage')!;
    expect(l.targets).toEqual(legsB);
  });

  test('latestIntents — stale(maxAgeMin 초과) 제외', () => {
    const db = memDb();
    submitIntent(db, internalSource('s:old'), { targets: legsA, now: new Date('2026-07-10T00:00:00Z') });
    submitIntent(db, internalSource('s:fresh'), { targets: legsB, now: new Date('2026-07-10T00:50:00Z') });
    const now = new Date('2026-07-10T01:00:00Z');
    const fresh = latestIntents(db, { maxAgeMin: 15, now });
    expect(fresh.map(e => e.sourceId)).toEqual(['s:fresh']); // old(60분전) 제외
  });

  test('pruneIntents — keepDays 이전 삭제', () => {
    const db = memDb();
    submitIntent(db, internalSource('s:x'), { targets: legsA, now: new Date('2026-06-01T00:00:00Z') });
    submitIntent(db, internalSource('s:y'), { targets: legsB, now: new Date('2026-07-10T00:00:00Z') });
    const removed = pruneIntents(db, 14, new Date('2026-07-10T00:00:00Z'));
    expect(removed).toBe(1);
    expect(latestIntents(db).length).toBe(1);
  });
});
