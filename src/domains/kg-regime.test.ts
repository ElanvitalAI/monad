import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from './kg-store.js';
import { regimeTransitionContext, renderRegimeTransition, AXIS_TO_NODES } from './kg-regime.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

function seed(db: Database): void {
  upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'group:M7', kind: 'group', name: '빅테크', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'group:P7', kind: 'group', name: '반도체공급', firstSeen: NOW, lastSeen: NOW });
  // 반도체 → 삼성 영향 · P7 → M7 역관계
  addEdge(db, { src: 'chain:반도체', dst: 'company:005930', relation: 'affects', weight: 0.6, validAt: NOW });
  addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', weight: -0.5, validAt: NOW });
}

describe('kg-regime — 국면↔온톨로지(추천5)', () => {
  test('transition=false → null(평시 조용)', () => {
    const db = freshDb(); seed(db);
    expect(regimeTransitionContext(db, { transition: false, transitionAxes: [], regimeLabel: 'RISK_ON' })).toBeNull();
  });
  test('★kr_sector 전환 → 반도체 진입 + 인과 파장', () => {
    const db = freshDb(); seed(db);
    const ctx = regimeTransitionContext(db, { transition: true, transitionAxes: ['kr_sector', 'kr_flow'], regimeLabel: 'BEAR_CASH' })!;
    expect(ctx.entryNodes).toContain('chain:반도체');
    expect(ctx.causal.some(h => h.node === 'company:005930')).toBe(true);   // 반도체→삼성 파급
  });
  test('us_sector 전환 → P7/M7 진입', () => {
    const db = freshDb(); seed(db);
    const ctx = regimeTransitionContext(db, { transition: true, transitionAxes: ['us_sector'], regimeLabel: 'RISK_ON' })!;
    expect(ctx.entryNodes).toContain('group:P7');
    expect(ctx.causal.some(h => h.node === 'group:M7')).toBe(true);   // P7→M7 역관계 파급
  });
  test('진입 노드 없으면 null(그래프 미구축)', () => {
    const db = freshDb();  // 노드 없음
    expect(regimeTransitionContext(db, { transition: true, transitionAxes: ['kr_sector'], regimeLabel: 'X' })).toBeNull();
  });
  test('render — 전환축·파급 노드', () => {
    const db = freshDb(); seed(db);
    const ctx = regimeTransitionContext(db, { transition: true, transitionAxes: ['us_sector'], regimeLabel: 'RISK_ON' });
    const s = renderRegimeTransition(db, ctx);
    expect(s).toContain('국면 전환 인과 파장');
    expect(s).toContain('us_sector');
  });
  test('render null = 빈', () => {
    expect(renderRegimeTransition(freshDb(), null)).toBe('');
  });
  test('AXIS_TO_NODES 주요 축 정의', () => {
    expect(AXIS_TO_NODES.kr_sector).toContain('chain:반도체');
    expect(AXIS_TO_NODES.us_sector).toContain('group:P7');
  });
});
