import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, addEdge } from './kg-store.js';
import { blastRadius, expectedReaction, residualOf } from './kg-infer.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const V = '2026-07-08';

describe('kg-infer — blast radius(R2)', () => {
  test('1-hop 영향 + 강도', () => {
    const db = freshDb();
    addEdge(db, { src: 'event:hbm', dst: 'company:005930', relation: 'affects', weight: 0.7, validAt: V });
    const hits = blastRadius(db, 'event:hbm');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe('company:005930');
    expect(hits[0]!.weight).toBeCloseTo(0.7, 3);
    expect(hits[0]!.hop).toBe(1);
  });
  test('★부호 전파 — 음의 엣지 지나면 방향 반전', () => {
    const db = freshDb();
    // event → P7 (양) → M7 (음·경쟁) : event가 M7엔 반대 영향
    addEdge(db, { src: 'event:chip-boom', dst: 'group:P7', relation: 'affects', weight: 0.8, validAt: V });
    addEdge(db, { src: 'group:P7', dst: 'group:M7', relation: 'correlates', weight: -0.6, validAt: V });
    const hits = blastRadius(db, 'event:chip-boom', { maxHop: 2, decay: 1 });
    const p7 = hits.find(h => h.node === 'group:P7')!;
    const m7 = hits.find(h => h.node === 'group:M7')!;
    expect(p7.weight).toBeGreaterThan(0);       // P7 양(수혜)
    expect(m7.weight).toBeLessThan(0);          // M7 음(반대·0.8×-0.6=-0.48)
    expect(m7.weight).toBeCloseTo(-0.48, 2);
  });
  test('거리 감쇠 — hop 늘수록 약화', () => {
    const db = freshDb();
    addEdge(db, { src: 'a', dst: 'b', relation: 'affects', weight: 1, validAt: V });
    addEdge(db, { src: 'b', dst: 'c', relation: 'affects', weight: 1, validAt: V });
    const hits = blastRadius(db, 'a', { maxHop: 2, decay: 0.6 });
    const b = hits.find(h => h.node === 'b')!, c = hits.find(h => h.node === 'c')!;
    expect(b.weight).toBeCloseTo(1, 3);        // hop1: 1×1×0.6^0
    expect(c.weight).toBeCloseTo(0.6, 3);      // hop2: 1×1×0.6^1
  });
  test('lead_lag 누적 — etaDays', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'cross_market', weight: 0.5, leadLag: 2, validAt: V });
    const hits = blastRadius(db, 'company:MU');
    expect(hits[0]!.lag).toBe(2);
  });
  test('국면 매칭(R2) — 다른 국면 엣지 제외', () => {
    const db = freshDb();
    addEdge(db, { src: 'a', dst: 'b', relation: 'correlates', weight: 0.7, regimeAt: 'RISK_ON', validAt: V });
    addEdge(db, { src: 'a', dst: 'c', relation: 'correlates', weight: 0.9, regimeAt: 'BEAR_CASH', validAt: V });
    const hits = blastRadius(db, 'a', { regime: 'RISK_ON' });
    expect(hits.map(h => h.node)).toEqual(['b']);   // BEAR 엣지 제외
  });
  test('minWeight 하한 미달 가지치기', () => {
    const db = freshDb();
    addEdge(db, { src: 'a', dst: 'b', relation: 'affects', weight: 0.03, validAt: V });
    expect(blastRadius(db, 'a', { minWeight: 0.05 })).toHaveLength(0);
  });
  test('belongs_to 는 blast 제외(멤버십≠영향)', () => {
    const db = freshDb();
    addEdge(db, { src: 'company:005930', dst: 'chain:반도체', relation: 'belongs_to', validAt: V });
    expect(blastRadius(db, 'company:005930')).toHaveLength(0);
  });
});

describe('kg-infer — 예측(R5)', () => {
  test('expectedReaction 방향·강도·etaDays', () => {
    const db = freshDb();
    addEdge(db, { src: 'event:x', dst: 'company:005930', relation: 'affects', weight: -0.6, leadLag: 1, validAt: V });
    const r = expectedReaction(db, 'event:x')[0]!;
    expect(r.symbol).toBe('005930');
    expect(r.direction).toBe(-1);      // 음의 영향
    expect(r.strength).toBeCloseTo(0.6, 3);
    expect(r.etaDays).toBe(1);
  });
});

describe('kg-infer — residual/이상치(R5)', () => {
  test('예측대로면 이상치 아님', () => {
    // 예측 +0.6 강도 → +1.8% 기대. 실측 +2% → residual 0.2 < 3
    const r = residualOf(1, 0.6, 2.0);
    expect(r.expectedPct).toBeCloseTo(1.8, 3);
    expect(r.isAnomaly).toBe(false);
  });
  test('★예측 반대로 움직이면 이상치(디깅 트리거)', () => {
    // 예측 + 인데 실측 -3% → residual 큼
    const r = residualOf(1, 0.7, -3.0);
    expect(r.residual).toBeLessThan(-4);
    expect(r.isAnomaly).toBe(true);
  });
  test('threshold 조정', () => {
    expect(residualOf(1, 0.5, 3.5, { thresholdPct: 5 }).isAnomaly).toBe(false);  // 완화
  });
});
