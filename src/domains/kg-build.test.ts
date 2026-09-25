import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, addEdge, upsertNode } from './kg-store.js';
import { detectAnomalies, enqueueAnomalyDigs, buildOntology } from './kg-build.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

describe('kg-build — 이상치 폐루프(R5)', () => {
  function seedTrigger(db: Database): void {
    upsertNode(db, { id: 'policy:us-export-control', kind: 'policy', name: '수출통제', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    // 정책 → 삼성 음의 영향(예상 하락)
    addEdge(db, { src: 'policy:us-export-control', dst: 'company:005930', relation: 'affects', weight: -0.7, validAt: NOW });
  }
  test('예측대로면 이상치 없음', () => {
    const db = freshDb(); seedTrigger(db);
    // 예상 -2.1% (dir -1 × 0.7 × 3). 실측 -2% → residual 작음
    const c = detectAnomalies(db, { actualResolver: () => -2.0 });
    expect(c).toHaveLength(0);
  });
  test('★예측 반대로 움직이면 이상치 후보(디깅)', () => {
    const db = freshDb(); seedTrigger(db);
    // 예상 하락인데 실측 +4% → 예측 이탈
    const c = detectAnomalies(db, { actualResolver: () => 4.0 });
    expect(c).toHaveLength(1);
    expect(c[0]!.symbol).toBe('005930');
    expect(c[0]!.residual).toBeGreaterThan(3);
  });
  test('actual 없으면 스킵(fail-soft)', () => {
    const db = freshDb(); seedTrigger(db);
    expect(detectAnomalies(db, { actualResolver: () => null })).toHaveLength(0);
  });
  test('minStrength 미달 예측 제외', () => {
    const db = freshDb();
    upsertNode(db, { id: 'event:x', kind: 'event', name: 'x', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:A', kind: 'company', name: 'A', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'event:x', dst: 'company:A', relation: 'affects', weight: 0.1, validAt: NOW });
    expect(detectAnomalies(db, { minStrength: 0.2, actualResolver: () => 10 })).toHaveLength(0);
  });
});

describe('kg-build — dig 적재(대표 게이트)', () => {
  test('enqueueAnomalyDigs → dig_queue 삽입', () => {
    const digDb = new Database(':memory:');
    const cands = [{ trigger: 'policy:x', node: 'company:005930', symbol: '005930', direction: -1 as const, strength: 0.7, expectedPct: -2.1, actualPct: 4, residual: 6.1 }];
    const n = enqueueAnomalyDigs(digDb, cands, NOW);
    expect(n).toBe(1);
    const rows = digDb.query(`SELECT id, topic, status FROM dig_queue`).all() as Array<{ id: string; topic: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.topic).toContain('예측 이탈');
    expect(rows[0]!.status).toBe('queued');
  });
  test('빈 후보 = 0', () => {
    expect(enqueueAnomalyDigs(new Database(':memory:'), [], NOW)).toBe(0);
  });
});

describe('kg-build — buildOntology 오케스트레이터', () => {
  test('seed + stats 구조(가격 로더 fail-soft)', () => {
    const db = freshDb();
    const r = buildOntology(NOW, { db });
    expect(r.seed.chains).toBeGreaterThan(0);      // 구조 seed 됨
    expect(r.seed.groups).toBe(2);                 // P7·M7
    expect(r.stats.nodes).toBeGreaterThan(0);
    expect(r.correlate).toBeDefined();             // 상관(실 데이터 유무 무관)
  });
});
