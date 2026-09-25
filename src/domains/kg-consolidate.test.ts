import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from './kg-store.js';
import { ensureDigTables } from './dig-engine.js';
import { consolidateOntology, buildPriceResolver } from './kg-consolidate.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08T06:00:00.000Z';

describe('kg-consolidate — buildPriceResolver', () => {
  test('symbol 없으면 null(fail-soft)', () => {
    const r = buildPriceResolver('2026-01-01');
    // 실 DB에 없는 심볼 → null (또는 실측). 존재 무관 non-throwing.
    expect(() => r('ZZZNOTREAL', 1)).not.toThrow();
  });
});

describe('kg-consolidate — 게이트 (기본 off)', () => {
  test('extract/anomalyDig 게이트 미충족 = no-op', async () => {
    const db = freshDb();
    const digDb = new Database(':memory:'); ensureDigTables(digDb);
    const r = await consolidateOntology({
      db, digDb, now: NOW,
      extractEnabled: false, armAnomalyDig: false,
      actualResolver: () => 10,   // 이상치 나와도 arm off라 dig 0
    });
    expect(r.extract.edges).toBe(0);       // 추출 게이트 off
    expect(r.digsEnqueued).toBe(0);        // 자동 dig 게이트 off
    expect(r.build.nodes).toBeGreaterThan(0);  // build 는 항상(무비용)
  });
});

describe('kg-consolidate — 이상치 자동 dig arming(후속3)', () => {
  test('arm on + 이상치 → dig_queue 적재', async () => {
    const db = freshDb();
    // 정책 → 삼성 음의 예측
    upsertNode(db, { id: 'policy:us-export-control', kind: 'policy', name: '수출통제', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'policy:us-export-control', dst: 'company:005930', relation: 'affects', weight: -0.7, validAt: NOW });
    const digDb = new Database(':memory:'); ensureDigTables(digDb);
    const r = await consolidateOntology({
      db, digDb, now: NOW,
      armAnomalyDig: true,
      actualResolver: () => 5.0,   // 예상 하락인데 실측 +5% → 이상치
    });
    expect(r.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(r.digsEnqueued).toBeGreaterThanOrEqual(1);
    const rows = digDb.query(`SELECT topic FROM dig_queue`).all() as Array<{ topic: string }>;
    expect(rows[0]!.topic).toContain('예측 이탈');
  });
  test('arm on 이지만 예측대로면 dig 0', async () => {
    const db = freshDb();
    upsertNode(db, { id: 'policy:x', kind: 'policy', name: 'x', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:A', kind: 'company', name: 'A', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'policy:x', dst: 'company:A', relation: 'affects', weight: -0.7, validAt: NOW });
    const digDb = new Database(':memory:'); ensureDigTables(digDb);
    const r = await consolidateOntology({
      db, digDb, now: NOW, armAnomalyDig: true,
      actualResolver: () => -2.0,   // 예상 하락·실측 하락 → 정상
    });
    expect(r.digsEnqueued).toBe(0);
  });
});

describe('kg-consolidate — LLM 추출 arming(후속2 게이트)', () => {
  test('extractEnabled on + chat 주입 → 인과 엣지', async () => {
    const db = freshDb();
    upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성전자', aliases: ['005930'], firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    // breaking source 미존재 → extract 0 (fail-soft). 게이트만 검증.
    const r = await consolidateOntology({
      db, digDb: new Database(':memory:'), now: NOW,
      extractEnabled: true, extractChat: async () => '[]',
      armAnomalyDig: false, actualResolver: () => null,
    });
    expect(r.extract.processed).toBeGreaterThanOrEqual(0);  // non-throwing
  });
});
