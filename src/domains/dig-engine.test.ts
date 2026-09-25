// M2.4 · dig-engine 온톨로지 회상 렌더러 단위테스트 (순수·인메모리).
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from './kg-store.js';
import { recallHybrid } from './kg-recall.js';
import { renderHybridForDig, pickSearchPlan, parseDerivedQuestions, enqueueDerivedQuestions, ensureDigTables } from './dig-engine.js';

const NOW = '2026-07-08T00:00:00.000Z';
const S = '2000-01-01T00:00:00.000Z';

function seededDb(): Database {
  const db = new Database(':memory:');
  ensureKgTables(db);
  upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', aliases: ['005930', 'Samsung'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:MU', kind: 'company', market: 'US', name: '마이크론', aliases: ['MU'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'chain:반도체', kind: 'chain', market: 'KR', name: '반도체', firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'subchain:반도체·메모리', kind: 'subchain', market: 'KR', name: '반도체·메모리', firstSeen: NOW, lastSeen: NOW });
  addEdge(db, { src: 'company:005930', dst: 'subchain:반도체·메모리', relation: 'belongs_to', validAt: S });
  addEdge(db, { src: 'subchain:반도체·메모리', dst: 'chain:반도체', relation: 'belongs_to', validAt: S });
  addEdge(db, { src: 'company:MU', dst: 'company:005930', relation: 'correlates', weight: 0.5, leadLag: 2, validAt: NOW });
  return db;
}

describe('renderHybridForDig', () => {
  test('엔티티 링킹 시 진입 엔티티·인과 파장을 렌더', () => {
    const db = seededDb();
    const kg = recallHybrid(db, { query: '삼성전자 반도체 전망', bump: false });
    const text = renderHybridForDig(db, kg);
    expect(text).toContain('진입 엔티티');
    expect(text).toContain('삼성전자');
    db.close();
  });

  test('클러스터 진입(chain:) 시 클러스터 요약 렌더', () => {
    const db = seededDb();
    const kg = recallHybrid(db, { vectorHits: ['chain:반도체'], bump: false });
    const text = renderHybridForDig(db, kg);
    expect(text).toContain('클러스터 반도체');
    db.close();
  });

  test('매칭 노드 없으면 빈 문자열(fail-soft)', () => {
    const db = seededDb();
    const kg = recallHybrid(db, { query: '전혀무관한텍스트XYZ', bump: false });
    const text = renderHybridForDig(db, kg);
    expect(text).toBe('');
    db.close();
  });

  test('부호 있는 인과 파장 — 방향 화살표 표기', () => {
    const db = seededDb();
    // MU→삼성 correlates(+0.5): 마이크론 진입 시 삼성 ▲ 파장
    const kg = recallHybrid(db, { query: '마이크론 MU 실적', bump: false });
    const text = renderHybridForDig(db, kg);
    expect(text).toMatch(/영향 파장/);
    expect(text).toMatch(/[▲▼]/);
    db.close();
  });
});

describe('pickSearchPlan (M2.1)', () => {
  test('고영향 breaking(score>=9) → deep 모드(engine 미지정)', () => {
    const p = pickSearchPlan({ id: 'signal:123', topic: '수출통제 강화', sector: 'semis', score: 9 });
    expect(p.mode).toBe('deep');
    expect(p.engine).toBeUndefined();
  });

  test('종목 디깅(pulse:) → ddg+firecrawl 병행', () => {
    const p = pickSearchPlan({ id: 'pulse:US:NVDA:2026-07-08', topic: '미국 NVDA 급등', sector: 'NVDA', score: 8 });
    expect(p.engine).toBe('ddg,firecrawl');
    expect(p.mode).toBeUndefined();
  });

  test('일반 신호(score<9) → ddg 단일(무료)', () => {
    const p = pickSearchPlan({ id: 'signal:456', topic: '평범한 뉴스', sector: 'other', score: 8 });
    expect(p.engine).toBe('ddg');
    expect(p.mode).toBeUndefined();
  });

  test('고score라도 종목(pulse:)은 deep 아님(비용가드)', () => {
    const p = pickSearchPlan({ id: 'pulse:KR:005930:2026-07-08', topic: '삼성 급등', sector: '삼성전자', score: 9 });
    expect(p.mode).toBeUndefined();
    expect(p.engine).toBe('ddg,firecrawl');
  });
});

describe('parseDerivedQuestions (M2.2)', () => {
  test('추가조사 불릿 라인에서 파생 질문 추출', () => {
    const v = `**국면판단**: 반도체 조정.\n**추가조사**:\n- HBM 수요 둔화가 구조적인가 일시적인가\n- 마이크론 가이던스와 삼성 상관성 확인\n`;
    const qs = parseDerivedQuestions(v);
    expect(qs.length).toBe(2);
    expect(qs[0]).toContain('HBM');
  });

  test('추가조사 항목 없으면 빈 배열', () => {
    expect(parseDerivedQuestions('**국면판단**: 끝.\n**확신도**: high 근거충분.')).toEqual([]);
  });

  test('"없음" 표기는 파생 아님', () => {
    expect(parseDerivedQuestions('**추가조사**: 없음\n\n')).toEqual([]);
  });
});

describe('enqueueDerivedQuestions (M2.2)', () => {
  function digDb(): Database {
    const db = new Database(':memory:');
    ensureDigTables(db);
    return db;
  }
  const parent = { id: 'signal:1', topic: '반도체 조정', sector: 'semis', score: 8 };

  test('파생 질문 재적재 — score 감쇠·parent 추적·depth+1', () => {
    const db = digDb();
    const n = enqueueDerivedQuestions(db, parent, ['HBM 수요 둔화 구조적인가', '환율 영향 확인'], 0);
    expect(n).toBe(2);
    const rows = db.prepare(`SELECT * FROM dig_queue WHERE parent_id=?`).all('signal:1') as any[];
    expect(rows.length).toBe(2);
    expect(rows[0].score).toBe(Math.floor(8 * 0.7));  // 5
    expect(rows[0].depth).toBe(1);
    db.close();
  });

  test('depth 가드 — 최대 깊이 도달 시 재적재 안 함', () => {
    const db = digDb();
    const n = enqueueDerivedQuestions(db, parent, ['더 파야 할 질문'], 2);  // MAX_DIG_DEPTH=2
    expect(n).toBe(0);
    db.close();
  });

  test('같은 파생 질문 dedup(재적재 안 됨)', () => {
    const db = digDb();
    enqueueDerivedQuestions(db, parent, ['동일 질문 텍스트'], 0);
    const n2 = enqueueDerivedQuestions(db, parent, ['동일 질문 텍스트'], 0);
    expect(n2).toBe(0);
    db.close();
  });

  test('마이그레이션 — 구 스키마(parent_id·depth 없음)에 ALTER 적용', () => {
    const db = new Database(':memory:');
    db.run(`CREATE TABLE dig_queue(id TEXT PRIMARY KEY, topic TEXT, sector TEXT, score INT, created_at TEXT, status TEXT DEFAULT 'queued')`);
    ensureDigTables(db);  // ALTER ADD COLUMN 적용되어야
    const n = enqueueDerivedQuestions(db, parent, ['신규 파생 질문 텍스트'], 0);
    expect(n).toBe(1);
    db.close();
  });
});
