import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge, type KgEdge } from './kg-store.js';
import { collectSemisView, dedupEdges, renderSemisEssential, renderSemisDetail } from './kg-semis.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-10';

function seedSemis(db: Database) {
  upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'subchain:HBM', kind: 'subchain', name: 'HBM', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:000660', kind: 'company', market: 'KR', name: 'SK하이닉스', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:NVDA', kind: 'company', market: 'US', name: '엔비디아', firstSeen: NOW, lastSeen: NOW });
  addEdge(db, { src: 'subchain:HBM', dst: 'chain:반도체', relation: 'belongs_to', validAt: NOW });
  addEdge(db, { src: 'company:005930', dst: 'subchain:HBM', relation: 'belongs_to', validAt: NOW });
  addEdge(db, { src: 'company:000660', dst: 'subchain:HBM', relation: 'belongs_to', validAt: NOW });
  addEdge(db, { src: 'company:000660', dst: 'company:005930', relation: 'supplies', weight: 1, validAt: NOW });
}

describe('kg-semis — dedupEdges', () => {
  test('같은 (src,dst) 쌍은 |weight| 최대만 유지', () => {
    const edges: KgEdge[] = [
      { id: 'a', src: 'x', dst: 'y', relation: 'correlates', weight: 0.5, validAt: '2026-07-06' },
      { id: 'b', src: 'x', dst: 'y', relation: 'correlates', weight: 0.9, validAt: '2026-07-07' },
      { id: 'c', src: 'x', dst: 'z', relation: 'correlates', weight: 0.3, validAt: '2026-07-07' },
    ];
    const out = dedupEdges(edges);
    expect(out.length).toBe(2);
    expect(out.find(e => e.dst === 'y')?.weight).toBe(0.9);
  });
});

describe('kg-semis — collectSemisView', () => {
  test('빈 그래프 = null', () => {
    expect(collectSemisView({ db: freshDb() })).toBeNull();
  });

  test('반도체 체인 = 멤버·밸류체인·전파 뷰', () => {
    const db = freshDb();
    seedSemis(db);
    // 미국→한국 전파(중복 쌍 포함 → dedup 검증).
    addEdge(db, { src: 'company:NVDA', dst: 'company:000660', relation: 'correlates', weight: 0.85, leadLag: 4, validAt: '2026-07-08', sourceRef: 'batch:leadlag' });
    addEdge(db, { src: 'company:NVDA', dst: 'company:000660', relation: 'correlates', weight: 0.93, leadLag: 5, validAt: '2026-07-09', sourceRef: 'batch:leadlag' });
    const v = collectSemisView({ db });
    expect(v).not.toBeNull();
    expect(v!.chainName).toBe('반도체');
    expect(v!.memberCount).toBeGreaterThanOrEqual(2);
    // 밸류체인 supplies(멤버 내부).
    expect(v!.supplies.some(s => s.upName === 'SK하이닉스' && s.downName === '삼성전자')).toBe(true);
    // 전파 dedup → 1건, |weight| 최대(0.93).
    const prop = v!.propagation.filter(p => p.dstName === 'SK하이닉스');
    expect(prop.length).toBe(1);
    expect(prop[0]!.weight).toBe(0.93);
    expect(prop[0]!.dir).toBe('동조');
  });

  test('P7↔M7 로테이션 포함', () => {
    const db = freshDb();
    seedSemis(db);
    upsertNode(db, { id: 'group:P7', kind: 'group', name: 'P7', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'group:M7', kind: 'group', name: 'M7', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', weight: -0.5, validAt: NOW, sourceRef: 'corr:group' });
    const v = collectSemisView({ db });
    expect(v!.p7m7?.rel).toContain('역관계');
  });
});

describe('kg-semis — 렌더', () => {
  test('null = 빈 문자열', () => {
    expect(renderSemisEssential(null)).toBe('');
    expect(renderSemisDetail(null)).toBe('');
  });
  test('essential = 전파 top3 + 헤더', () => {
    const db = freshDb();
    seedSemis(db);
    addEdge(db, { src: 'company:NVDA', dst: 'company:000660', relation: 'correlates', weight: 0.93, leadLag: 5, validAt: NOW, sourceRef: 'batch:leadlag' });
    const v = collectSemisView({ db });
    const ess = renderSemisEssential(v);
    expect(ess).toContain('반도체 밸류체인');
    expect(ess).toContain('엔비디아→SK하이닉스');
    const detail = renderSemisDetail(v);
    expect(detail).toContain('## 🇰🇷 반도체 밸류체인');
    expect(detail).toContain('| 소스 | 대상 | 방향 |');
  });
});
