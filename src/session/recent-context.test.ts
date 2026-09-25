// 세션 최신-스코프 빠른 회수 단위테스트(순수).
import { describe, test, expect } from 'bun:test';
import { getRecentMessages, getMessagesAround, findRecentMatches } from './recent-context.js';

const M = (role: string, content: string, ts: string, toolName?: string) => ({ role, content, ts, ...(toolName ? { toolName } : {}) });
const msgs = [
  M('user', '삼성전자 어때', '2026-07-10T01:00:00Z'),
  M('assistant', '삼성전자 분석...', '2026-07-10T01:00:05Z'),
  M('tool', 'quote result', '2026-07-10T01:00:06Z', 'omniQuote'),
  M('user', '하이닉스는', '2026-07-10T02:00:00Z'),
  M('assistant', '하이닉스 분석...', '2026-07-10T02:00:05Z'),
];

describe('getRecentMessages', () => {
  test('최신 N개 대화(tool 제외)·시간순 반환', () => {
    const r = getRecentMessages(msgs, { limit: 2 });
    expect(r.map(m => m.content)).toEqual(['하이닉스는', '하이닉스 분석...']); // 최신 2개·시간순
    expect(r.every(m => m.role !== 'tool')).toBe(true);
    expect(r[0]!.ts).toBe('2026-07-10T02:00:00Z'); // 타임스탬프 노출
  });
  test('includeTool → tool 포함', () => {
    const r = getRecentMessages(msgs, { limit: 3, includeTool: true });
    expect(r.some(m => m.role === 'tool')).toBe(true);
  });
  test('sinceTs → 최근 시각 이후만("최근 N분")', () => {
    const r = getRecentMessages(msgs, { limit: 20, sinceTs: '2026-07-10T01:30:00Z' });
    expect(r.map(m => m.content)).toEqual(['하이닉스는', '하이닉스 분석...']);
  });
  test('beforeTs → 스크롤백(그 이전만)', () => {
    const r = getRecentMessages(msgs, { limit: 20, beforeTs: '2026-07-10T01:30:00Z' });
    expect(r.map(m => m.content)).toEqual(['삼성전자 어때', '삼성전자 분석...']);
  });
});

describe('getMessagesAround', () => {
  test('앵커 ±radius 윈도', () => {
    const r = getMessagesAround(msgs, 3, 1); // index3(하이닉스는) ±1
    expect(r.map(m => m.index)).toEqual([2, 3, 4]);
  });
  test('경계 클램프', () => {
    expect(getMessagesAround(msgs, 0, 5).map(m => m.index)).toEqual([0, 1, 2, 3, 4]);
    expect(getMessagesAround(msgs, 99, 2)).toEqual([]); // 범위 밖
  });
});

describe('findRecentMatches', () => {
  test('최신-우선 검색·limit 조기종료·최신순', () => {
    const r = findRecentMatches(msgs, '분석', { limit: 1 });
    expect(r).toHaveLength(1);
    expect(r[0]!.content).toBe('하이닉스 분석...'); // 최신 매치 먼저
  });
  test('빈 쿼리 → []', () => {
    expect(findRecentMatches(msgs, '')).toEqual([]);
  });
  test('대소문자 무관·tool 기본 제외', () => {
    expect(findRecentMatches(msgs, '삼성전자').length).toBe(2);
    expect(findRecentMatches(msgs, 'quote', { includeTool: false })).toEqual([]);
  });
});
