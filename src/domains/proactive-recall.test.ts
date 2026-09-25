// 선제적 능동 회상(축B B1b) 단위테스트 — 회상+강화(recall_count++)·주입 블록·인메모리·결정론.
import { describe, test, expect } from 'bun:test';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';
import { proactiveRecall, formatRecallBlock } from './proactive-recall.js';

const NOW = Date.parse('2026-07-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3.6e6).toISOString();

describe('proactiveRecall — 판단 전 선제 회상 + 강화', () => {
  test('관련 과거를 회상하고 recall_count 를 증분(retrieval practice)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const rel = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'note', text: 'UX 에이전트 리액션 배선 결정', importance: 8, domain: 'coding', ts: hoursAgo(5) });
    recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'note', text: '무관한 잡담', importance: 1, domain: 'general', ts: hoursAgo(300) });

    const r = proactiveRecall(db, { query: 'UX 리액션', domain: 'coding', nowMs: NOW });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.some((h) => h.id === rel)).toBe(true);

    // 강화 실측 — 회상된 관련 이벤트의 recall_count 가 증분됨.
    const cnt = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(rel) as { c: number }).c;
    expect(cnt).toBe(1);
    db.close();
  });

  test('bump:false 면 강화 안 함(read-only 진단)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const id = recordEvent(db, { surface: 'x', direction: 'outbound', kind: 'note', text: '진단 대상', importance: 5, domain: 'coding', ts: hoursAgo(3) });
    proactiveRecall(db, { query: '진단', domain: 'coding', bump: false, nowMs: NOW });
    const cnt = (db.query(`SELECT recall_count c FROM events WHERE id=?`).get(id) as { c: number }).c;
    expect(cnt).toBe(0);
    db.close();
  });

  test('회상 0건이면 빈 블록(무노이즈)', () => {
    const db = openSurfaceEventsDb(':memory:');
    const r = proactiveRecall(db, { query: '존재하지않는키워드zzz', domain: 'coding', nowMs: NOW });
    expect(r.block).toBe('');
    db.close();
  });
});

describe('formatRecallBlock', () => {
  test('빈 hits → 빈 문자열', () => {
    expect(formatRecallBlock([], NOW)).toBe('');
  });
  test('hits → 헤더 + top-5 라인(도메인/시각 태그)', () => {
    const hits = [
      { id: 'a', ts: hoursAgo(2), surface: 'x', direction: 'outbound', kind: 'note', session_id: null, thread_id: null, text: '결정 A', summary: null, importance: 8, tags: null, refs: null, category: null, domain: 'coding', recall_count: 1, consolidated: 0, score: 1 },
    ];
    const block = formatRecallBlock(hits, NOW);
    expect(block).toContain('[선제 회상');
    expect(block).toContain('#coding');
    expect(block).toContain('결정 A');
  });
});
