import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { ensureKgTables, upsertNode } from './kg-store.js';
import { parseTriples, extractCausal, EXTRACT_SYSTEM, extractAndStore, digConfidenceFactor } from './kg-extract.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

function seedNodes(db: Database): void {
  upsertNode(db, { id: 'policy:us-export-control', kind: 'policy', name: '미국 수출통제', aliases: ['수출통제'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'company:005930', kind: 'company', name: '삼성전자', aliases: ['005930'], firstSeen: NOW, lastSeen: NOW });
  upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
}

describe('kg-extract — parseTriples(순수)', () => {
  const valid = new Set(['policy:us-export-control', 'company:005930', 'chain:반도체']);
  test('유효 triple 파싱', () => {
    const raw = '[{"from":"policy:us-export-control","relation":"affects","to":"company:005930","confidence":0.7}]';
    const t = parseTriples(raw, valid);
    expect(t).toHaveLength(1);
    expect(t[0]!.relation).toBe('affects');
    expect(t[0]!.confidence).toBe(0.7);
  });
  test('후보에 없는 엔티티 제외', () => {
    const raw = '[{"from":"company:UNKNOWN","relation":"causes","to":"company:005930"}]';
    expect(parseTriples(raw, valid)).toHaveLength(0);
  });
  test('상관 등 비인과 관계 제외(causes/affects만)', () => {
    const raw = '[{"from":"chain:반도체","relation":"correlates","to":"company:005930"}]';
    expect(parseTriples(raw, valid)).toHaveLength(0);
  });
  test('self-loop 제외', () => {
    const raw = '[{"from":"company:005930","relation":"causes","to":"company:005930"}]';
    expect(parseTriples(raw, valid)).toHaveLength(0);
  });
  test('설명 섞인 출력에서 JSON 슬라이스', () => {
    const raw = '분석 결과입니다: [{"from":"policy:us-export-control","relation":"causes","to":"chain:반도체","confidence":0.6}] 이상.';
    expect(parseTriples(raw, valid)).toHaveLength(1);
  });
  test('깨진 JSON = 빈 배열(fail-soft)', () => {
    expect(parseTriples('not json', valid)).toEqual([]);
    expect(parseTriples('[{broken', valid)).toEqual([]);
  });
  test('confidence 클램프', () => {
    const raw = '[{"from":"policy:us-export-control","relation":"affects","to":"chain:반도체","confidence":5}]';
    expect(parseTriples(raw, valid)[0]!.confidence).toBe(1);
  });
});

describe('kg-extract — extractCausal(chat 주입)', () => {
  test('후보 링킹 + LLM triple → 반환', async () => {
    const db = freshDb(); seedNodes(db);
    const fakeChat = async () => '[{"from":"policy:us-export-control","relation":"affects","to":"company:005930","confidence":0.8}]';
    const t = await extractCausal(db, '미국 수출통제로 삼성전자 타격', fakeChat);
    expect(t).toHaveLength(1);
    expect(t[0]!.from).toBe('policy:us-export-control');
    expect(t[0]!.to).toBe('company:005930');
  });
  test('후보 2 미만이면 LLM 호출 안 함(빈)', async () => {
    const db = freshDb(); seedNodes(db);
    let called = false;
    const spyChat = async () => { called = true; return '[]'; };
    const t = await extractCausal(db, '삼성전자만 언급', spyChat);   // 후보 1개
    expect(t).toEqual([]);
    expect(called).toBe(false);
  });
  test('LLM 빈 응답 = 빈(fail-soft)', async () => {
    const db = freshDb(); seedNodes(db);
    const t = await extractCausal(db, '수출통제와 삼성전자 반도체', async () => '');
    expect(t).toEqual([]);
  });
});

describe('kg-extract — 시스템 프롬프트', () => {
  test('ASCII+한글·causes/affects 명시', () => {
    expect(EXTRACT_SYSTEM).toMatch(/causes/);
    expect(EXTRACT_SYSTEM).toMatch(/affects/);
    // ASCII only 가드(한글 허용·특수 dash 금지)
    expect(EXTRACT_SYSTEM).not.toMatch(/[–—]/);   // en/em dash 없음
  });
});

describe('kg-extract — C.6 dig 확신도 전파', () => {
  test('digConfidenceFactor 매핑(high>med>low·미상=중립)', () => {
    expect(digConfidenceFactor('high')).toBe(1.0);
    expect(digConfidenceFactor('med')).toBe(0.75);
    expect(digConfidenceFactor('low')).toBe(0.5);
    expect(digConfidenceFactor('goal-v2')).toBe(0.75);   // 중립
    expect(digConfidenceFactor(undefined)).toBe(0.75);
    expect(digConfidenceFactor('HIGH')).toBe(1.0);        // 대소문자 무관
  });

  // 단일 확신도 dig 1건 → 추출된 엣지 confidence 반환(별도 KG·엣지 dedup 회피).
  async function edgeConfForDig(conf: string): Promise<number> {
    const srcPath = join(tmpdir(), `kg-extract-test-${conf}-${Date.now()}.db`);
    const src = new Database(srcPath);
    src.run(`CREATE TABLE dig_reports(id INTEGER PRIMARY KEY, ts TEXT, queue_id TEXT, topic TEXT, sector TEXT, verdict TEXT, confidence TEXT)`);
    src.prepare(`INSERT INTO dig_reports(ts, queue_id, topic, verdict, confidence) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),?,?,?,?)`).run(`q-${conf}`, '수출통제 반도체 영향', '삼성 타격', conf);
    src.close();
    const db = freshDb(); seedNodes(db);
    // 텍스트에 링크되는 엔티티(수출통제·반도체)만 타겟(extractCausal linkEntities≥2).
    const chat = async () => '[{"from":"policy:us-export-control","relation":"affects","to":"chain:반도체","confidence":0.8}]';
    await extractAndStore(db, srcPath, { enabled: true, chat, now: NOW });
    const row = db.query(`SELECT confidence FROM kg_edges WHERE src='policy:us-export-control' LIMIT 1`).get() as { confidence: number } | null;
    try { unlinkSync(srcPath); } catch { /* */ }
    return row?.confidence ?? -1;
  }

  test('고확신 dig → 강한 엣지(0.6), 저확신 → 약한 엣지(0.3)', async () => {
    // min(0.6, 0.8)=0.6 × digFactor.
    expect(await edgeConfForDig('high')).toBeCloseTo(0.6, 5);   // ×1.0
    expect(await edgeConfForDig('low')).toBeCloseTo(0.3, 5);    // ×0.5
  });
});
