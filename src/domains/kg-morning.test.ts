import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from './kg-store.js';
import { renderOntologyMorning } from './kg-morning.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

describe('kg-morning — 아침 온톨로지 섹션', () => {
  test('빈 그래프 = 빈 문자열(fail-soft)', () => {
    expect(renderOntologyMorning({ db: freshDb() })).toBe('');
  });
  test('★미국→한국 전파 렌더', () => {
    const db = freshDb();
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:NVDA', kind: 'company', market: 'US', name: '엔비디아', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.85, leadLag: 3, validAt: NOW, sourceRef: 'batch:leadlag' });
    const s = renderOntologyMorning({ db });
    expect(s).toContain('온톨로지');
    expect(s).toContain('미국→한국 전파');
    expect(s).toContain('엔비디아→삼성전자');
    expect(s).toContain('동조');
    expect(s).toContain('3일 선행');
  });
  test('P7↔M7 역관계 렌더', () => {
    const db = freshDb();
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'group:P7', kind: 'group', name: 'P7', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'group:M7', kind: 'group', name: 'M7', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', weight: -0.55, validAt: NOW, sourceRef: 'corr:group-basket' });
    const s = renderOntologyMorning({ db });
    expect(s).toContain('P7');
    expect(s).toContain('역관계');
  });
  test('★중복 (src,dst) 쌍은 1회만 출력(dedup 회귀)', () => {
    const db = freshDb();
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:NVDA', kind: 'company', market: 'US', name: '엔비디아', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', firstSeen: NOW, lastSeen: NOW });
    // 같은 쌍이 다른 validAt 으로 3행(과거 버그: 3중 출력).
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.85, leadLag: 3, validAt: '2026-07-06', sourceRef: 'batch:leadlag' });
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.90, leadLag: 5, validAt: '2026-07-07', sourceRef: 'batch:leadlag' });
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.88, leadLag: 4, validAt: '2026-07-08', sourceRef: 'batch:leadlag' });
    const s = renderOntologyMorning({ db });
    const hits = (s.match(/엔비디아→삼성전자/g) || []).length;
    expect(hits).toBe(1);
    expect(s).toContain('0.9');   // |weight| 최대(0.90)만 유지
  });
  test('약한 전파(<0.6)는 제외', () => {
    const db = freshDb();
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:NVDA', kind: 'company', market: 'US', name: '엔비디아', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'company:NVDA', dst: 'company:005930', relation: 'correlates', weight: 0.3, leadLag: 1, validAt: NOW, sourceRef: 'batch:leadlag' });
    const s = renderOntologyMorning({ db });
    expect(s).not.toContain('미국→한국 전파');   // 약해서 제외 → 섹션 비면 ''
  });
});
