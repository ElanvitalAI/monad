import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge, getNode } from './kg-store.js';
import { linkEntities, recallCluster, recallHybrid } from './kg-recall.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';
const S = '2000-01-01';

function seedMini(db: Database): void {
  upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', aliases: ['005930', 'Samsung'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: '마이크론', aliases: ['MU'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'chain:반도체', kind: 'chain', market: 'KR', name: '반도체', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'subchain:반도체·메모리', kind: 'subchain', market: 'KR', name: '반도체·메모리', firstSeen: NOW, lastSeen: NOW });
  addEdge(db, { src: 'company:005930', dst: 'subchain:반도체·메모리', relation: 'belongs_to', validAt: S });
  addEdge(db, { src: 'subchain:반도체·메모리', dst: 'chain:반도체', relation: 'belongs_to', validAt: S });
  addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'correlates', weight: 0.5, leadLag: 2, validAt: NOW });
}

describe('kg-recall — linkEntities', () => {
  test('한글명 substring 매칭', () => {
    const db = freshDb(); seedMini(db);
    expect(linkEntities(db, '오늘 삼성전자 실적이 좋다')).toContain('company:005930');
  });
  test('★티커 단어경계 매칭(오탐 방지)', () => {
    const db = freshDb(); seedMini(db);
    expect(linkEntities(db, 'MU 실적 발표')).toContain('company:MU');       // 매칭
    expect(linkEntities(db, 'museum 방문')).not.toContain('company:MU');    // MU 부분문자 오탐 X
  });
  test('빈 텍스트 = 빈 결과', () => {
    const db = freshDb(); seedMini(db);
    expect(linkEntities(db, '')).toEqual([]);
  });
});

describe('kg-recall — recallCluster(R1)', () => {
  test('체인 → 서브체인 + 종목 확장', () => {
    const db = freshDb(); seedMini(db);
    const c = recallCluster(db, 'chain:반도체')!;
    expect(c.name).toBe('반도체');
    expect(c.subclusters).toContain('subchain:반도체·메모리');
    expect(c.members).toContain('company:005930');   // 2-depth 종목
  });
  test('없는 클러스터 = null', () => {
    const db = freshDb();
    expect(recallCluster(db, 'chain:없음')).toBeNull();
  });
});

describe('kg-recall — recallHybrid', () => {
  test('질의 → 링킹 + cluster + 인과 확장', () => {
    const db = freshDb(); seedMini(db);
    const r = recallHybrid(db, { query: '반도체 전망', bump: false });
    expect(r.seeds).toContain('chain:반도체');
    expect(r.clusters.some(c => c.id === 'chain:반도체')).toBe(true);
  });
  test('마이크론 질의 → 인과(삼성 correlates) 확장', () => {
    const db = freshDb(); seedMini(db);
    const r = recallHybrid(db, { query: 'MU 실적', bump: false });
    expect(r.causal.some(h => h.node === 'company:005930')).toBe(true);   // 마이크론→삼성
  });
  test('vectorHits 주입 seam', () => {
    const db = freshDb(); seedMini(db);
    const r = recallHybrid(db, { vectorHits: ['chain:반도체'], bump: false });
    expect(r.seeds).toContain('chain:반도체');
  });
  test('★recall_count++ (미엘린 M4.1)', () => {
    const db = freshDb(); seedMini(db);
    recallHybrid(db, { query: '반도체', bump: true });
    expect(getNode(db, 'chain:반도체')!.recallCount!).toBeGreaterThanOrEqual(1);
  });
});
