import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  ensureKgTables, upsertNode, addEdge, invalidateEdge, getNode, listNodes,
  getEdges, bumpRecall, kgStats, nodeId, edgeId,
} from './kg-store.js';

function freshDb(): Database {
  const db = new Database(':memory:');
  ensureKgTables(db);
  return db;
}
const NOW = '2026-07-08';

describe('kg-store — id 규약', () => {
  test('nodeId = kind:key', () => {
    expect(nodeId('company', '005930')).toBe('company:005930');
    expect(nodeId('group', 'P7')).toBe('group:P7');
  });
  test('edgeId 결정론 · (src,relation,dst,valid_at) 동일 → 같은 id', () => {
    const a = edgeId('company:005930', 'supplies', 'company:000660', NOW);
    const b = edgeId('company:005930', 'supplies', 'company:000660', NOW);
    expect(a).toBe(b);
    expect(a).not.toBe(edgeId('company:005930', 'supplies', 'company:000660', '2026-07-09'));
    expect(a).toHaveLength(12);
  });
});

describe('kg-store — 노드 upsert', () => {
  test('삽입 + 조회', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자',
      aliases: ['005930', 'Samsung'], meta: { ticker: '005930.KO' }, firstSeen: NOW, lastSeen: NOW });
    const n = getNode(db, 'company:005930')!;
    expect(n.name).toBe('삼성전자');
    expect(n.market).toBe('KR');
    expect(n.aliases).toEqual(['005930', 'Samsung']);
    expect(n.meta).toEqual({ ticker: '005930.KO' });
  });
  test('멱등 upsert — recall_count·first_seen 보존, last_seen 갱신', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    bumpRecall(db, ['company:005930']);           // recall_count → 1
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성전자', firstSeen: '2026-07-09', lastSeen: '2026-07-09' });
    const n = getNode(db, 'company:005930')!;
    expect(n.name).toBe('삼성전자');       // 갱신
    expect(n.firstSeen).toBe(NOW);          // 보존(excluded 무시)
    expect(n.lastSeen).toBe('2026-07-09');  // 갱신
    expect(n.recallCount).toBe(1);          // 보존
  });
  test('listNodes kind/market 필터', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: 'Micron', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', market: 'KR', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    expect(listNodes(db, { kind: 'company' })).toHaveLength(2);
    expect(listNodes(db, { market: 'US' })).toHaveLength(1);
    expect(listNodes(db, { kind: 'company', market: 'KR' })).toHaveLength(1);
  });
});

describe('kg-store — 엣지 append + temporal', () => {
  test('addEdge 부호 weight·lead_lag 보존', () => {
    const db = freshDb();
    // R8 음의 관계(경쟁): P7 ↔ M7 역상관
    addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'competes_with',
      weight: -0.62, leadLag: 0, regimeAt: 'RISK_ON', validAt: NOW, sourceRef: 'corr:screener', extractedBy: 'correlation' });
    const e = getEdges(db, { src: 'group:P7' })[0]!;
    expect(e.relation).toBe('competes_with');
    expect(e.weight).toBe(-0.62);         // ★음수 보존
    expect(e.regimeAt).toBe('RISK_ON');
  });
  test('addEdge 멱등 — 같은 관측(id) 재삽입 시 1건', () => {
    const db = freshDb();
    const e = { src: 'company:MU', dst: 'company:005930', relation: 'correlates' as const, weight: 0.4, validAt: NOW };
    addEdge(db, e); addEdge(db, { ...e, weight: 0.5 });  // 같은 id → upsert
    const edges = getEdges(db, { src: 'company:MU' });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBe(0.5);   // 최신 관측 반영
  });
  test('lead_lag — 마이크론(US) → 삼성(KR) 2일 선행', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'cross_market', weight: 0.55, leadLag: 2, validAt: NOW });
    expect(getEdges(db, { src: 'company:MU' })[0]!.leadLag).toBe(2);
  });
  test('invalidateEdge — activeOnly 필터가 무효 엣지 제외', () => {
    const db = freshDb();
    const id = addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'competes_with', weight: -0.6, validAt: NOW });
    expect(getEdges(db, { src: 'group:P7', activeOnly: true })).toHaveLength(1);
    invalidateEdge(db, id, '2026-07-20');   // 관계 반전
    expect(getEdges(db, { src: 'group:P7', activeOnly: true })).toHaveLength(0);  // 제외
    expect(getEdges(db, { src: 'group:P7' })).toHaveLength(1);                    // 이력 보존
  });
  test('getEdges relation 필터', () => {
    const db = freshDb();
    addEdge(db, { src: 'chain:반도체', dst: 'subchain:HBM', relation: 'belongs_to', validAt: NOW });
    addEdge(db, { src: 'subchain:소재', dst: 'subchain:HBM', relation: 'supplies', weight: 0.5, validAt: NOW });
    expect(getEdges(db, { relation: 'supplies' })).toHaveLength(1);
    expect(getEdges(db, { relation: 'belongs_to' })).toHaveLength(1);
  });
});

describe('kg-store — 통계', () => {
  test('kgStats nodes·edges·activeEdges', () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    const id = addEdge(db, { src: 'a', dst: 'b', relation: 'correlates', weight: 0.3, validAt: NOW });
    addEdge(db, { src: 'a', dst: 'c', relation: 'correlates', weight: -0.2, validAt: NOW });
    invalidateEdge(db, id, '2026-07-20');
    expect(kgStats(db)).toEqual({ nodes: 1, edges: 2, activeEdges: 1 });
  });
});
