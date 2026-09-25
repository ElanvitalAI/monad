import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, getEdges, getNode, listNodes } from './kg-store.js';
import { seedCrossMarket, seedThemeGroups, seedAll } from './kg-seed.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

describe('kg-seed — 한미 크로스마켓(R3)', () => {
  test('US 종목 노드 market=US + 이름', () => {
    const db = freshDb();
    const c = seedCrossMarket(db, NOW);
    expect(c.usCompanies).toBe(11);
    const mu = getNode(db, 'company:MU')!;
    expect(mu.market).toBe('US');
    expect(mu.name).toBe('마이크론');
  });
  test('cross_market 링크 방향 US→KR', () => {
    const db = freshDb();
    seedCrossMarket(db, NOW);
    const e = getEdges(db, { src: 'company:MU', relation: 'cross_market' });
    expect(e.some(x => x.dst === 'company:005930')).toBe(true);  // 마이크론→삼성
    expect(e.some(x => x.dst === 'company:000660')).toBe(true);  // 마이크론→SK하이닉스
  });
  test('수출통제 정책 → 반도체 affects(음의 방향)', () => {
    const db = freshDb();
    const c = seedCrossMarket(db, NOW);
    expect(c.policies).toBe(1);
    const e = getEdges(db, { src: 'policy:us-export-control', relation: 'affects' })[0]!;
    expect(e.dst).toBe('chain:반도체');
    expect(e.weight).toBe(-0.5);   // 규제=음의 영향
  });
});

describe('kg-seed — 테마 그룹(R7)', () => {
  test('group:P7·group:M7 노드 + 멤버 belongs_to', () => {
    const db = freshDb();
    const c = seedThemeGroups(db, NOW);
    expect(c.groups).toBe(2);
    expect(c.groupMembers).toBe(11);  // P7 4 + M7 7
    // 마이크론 → group:P7
    expect(getEdges(db, { src: 'company:MU', relation: 'belongs_to' }).some(e => e.dst === 'group:P7')).toBe(true);
    // 엔비디아 → group:M7
    expect(getEdges(db, { src: 'company:NVDA', relation: 'belongs_to' }).some(e => e.dst === 'group:M7')).toBe(true);
  });
  test('P7 ↔ M7 competes_with 양방향 토폴로지 (weight는 상관 pass가 채움)', () => {
    const db = freshDb();
    const c = seedThemeGroups(db, NOW);
    expect(c.competes).toBe(2);
    const p7 = getEdges(db, { src: 'group:P7', relation: 'competes_with' })[0]!;
    expect(p7.dst).toBe('group:M7');
    expect(p7.weight).toBeUndefined();  // 토폴로지만·강도 미정
    expect(getEdges(db, { src: 'group:M7', relation: 'competes_with' })[0]!.dst).toBe('group:P7');
  });
});

describe('kg-seed — seedAll 통합', () => {
  test('구조+한미+테마 노드 종류 존재', () => {
    const db = freshDb();
    const c = seedAll(db, NOW);
    expect(c.chains).toBeGreaterThan(0);      // 구조
    expect(c.usCompanies).toBe(11);           // 한미
    expect(c.groups).toBe(2);                 // 테마
    expect(listNodes(db, { kind: 'group' })).toHaveLength(2);
    expect(listNodes(db, { kind: 'policy' })).toHaveLength(1);
    expect(listNodes(db, { market: 'US' }).length).toBeGreaterThanOrEqual(11);
  });
  test('멱등 — 재실행 US 종목 수 불변', () => {
    const db = freshDb();
    seedAll(db, NOW);
    seedAll(db, '2026-07-09');
    expect(listNodes(db, { market: 'US' }).filter(n => n.kind === 'company')).toHaveLength(11);
  });
});
