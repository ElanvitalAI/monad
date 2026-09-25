import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, addEdge, invalidateEdge, getEdges, pruneEdges } from './kg-store.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

describe('kg-store — SHY pruneEdges', () => {
  test('오래된 무효 엣지 삭제(grace 초과)', () => {
    const db = freshDb();
    const id = addEdge(db, { src: 'a', dst: 'b', relation: 'correlates', weight: 0.5, validAt: '2026-01-01' });
    invalidateEdge(db, id, '2026-01-10');   // 무효화(약 180일 전)
    addEdge(db, { src: 'a', dst: 'c', relation: 'correlates', weight: 0.4, validAt: NOW }); // 활성 유지
    const r = pruneEdges(db, { now: NOW, invalidGraceDays: 90 });
    expect(r.invalidPruned).toBe(1);
    expect(getEdges(db, { src: 'a' })).toHaveLength(1);   // 활성만 남음
  });
  test('grace 이내 무효 엣지는 보존(감사)', () => {
    const db = freshDb();
    const id = addEdge(db, { src: 'a', dst: 'b', relation: 'correlates', weight: 0.5, validAt: '2026-07-01' });
    invalidateEdge(db, id, '2026-07-05');   // 3일 전 무효
    const r = pruneEdges(db, { now: NOW, invalidGraceDays: 90 });
    expect(r.invalidPruned).toBe(0);
    expect(getEdges(db, { src: 'a' })).toHaveLength(1);
  });
  test('★pair 당 최신 keepPerPair 관측만 유지', () => {
    const db = freshDb();
    // 같은 pair 5개 관측(다른 valid_at)
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']) {
      addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'correlates', weight: 0.4, validAt: d });
    }
    expect(getEdges(db, { src: 'company:MU' })).toHaveLength(5);
    const r = pruneEdges(db, { now: NOW, keepPerPair: 3 });
    expect(r.dupPruned).toBe(2);
    const left = getEdges(db, { src: 'company:MU' });
    expect(left).toHaveLength(3);
    // 최신 3개(07-03,04,05) 유지
    expect(left.map(e => e.validAt).sort()).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
  });
  test('구조 엣지(belongs_to)는 prune 대상 아님(기본 correlates만)', () => {
    const db = freshDb();
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']) {
      // belongs_to는 STRUCTURAL_VALID_AT라 실제론 같은 id지만, 테스트로 다른 valid_at 강제
      addEdge(db, { src: 'x', dst: 'y', relation: 'belongs_to', validAt: d });
    }
    const r = pruneEdges(db, { now: NOW, keepPerPair: 2 });
    expect(r.dupPruned).toBe(0);   // correlates만 대상
    expect(getEdges(db, { relation: 'belongs_to' })).toHaveLength(4);
  });
  test('빈 그래프 = no-op', () => {
    const db = freshDb();
    expect(pruneEdges(db, { now: NOW })).toEqual({ invalidPruned: 0, dupPruned: 0 });
  });
});
