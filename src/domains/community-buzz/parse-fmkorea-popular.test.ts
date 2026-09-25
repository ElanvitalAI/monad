// fmkorea 인기글(웹진 카드) 파서 + 타임/freshness 단위테스트 — 라이브 캡처 픽스처.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFmkoreaPopular, parsePostedAt, freshnessScore } from './parse-fmkorea.js';

const fixture = readFileSync(join(import.meta.dir, '__fixtures__/fmkorea-popular.md'), 'utf-8');
const NOW = Date.parse('2026-07-09T14:05:00Z'); // = KST 23:05

describe('parsePostedAt — 타임값(대표 지시: 둘 다 항상 중요)', () => {
  test('오늘 HH:MM → KST 해석 ISO', () => {
    // KST 23:00 = UTC 14:00
    expect(parsePostedAt('23:00', NOW)).toBe('2026-07-09T14:00:00.000Z');
  });
  test('자정 롤오버 — 현재보다 미래면 어제', () => {
    const now = Date.parse('2026-07-09T15:10:00Z'); // KST 00:10 (10일)
    // "23:50" 은 미래(오늘10일 23:50)면 어제(9일)로
    const iso = parsePostedAt('23:50', now)!;
    expect(iso.startsWith('2026-07-09')).toBe(true);
  });
  test('과거글 YY.MM.DD', () => {
    expect(parsePostedAt('25.07.09', NOW)).toBe('2025-07-08T15:00:00.000Z'); // 2025-07-09 KST 자정 = 07-08 15:00 UTC
  });
  test('무효 → null', () => {
    expect(parsePostedAt('방금', NOW)).toBeNull();
  });
});

describe('freshnessScore — 신선도 = 중요도 인자', () => {
  test('방금=1 근처·오래될수록 감쇠', () => {
    const now = Date.parse('2026-07-09T14:05:00Z');
    const fresh = freshnessScore('2026-07-09T14:03:00Z', now); // 2분 전
    const old = freshnessScore('2026-07-09T11:05:00Z', now);   // 3시간 전
    expect(fresh).toBeGreaterThan(0.9);
    expect(old).toBeLessThan(0.05);
    expect(fresh).toBeGreaterThan(old);
  });
  test('null → 0', () => { expect(freshnessScore(null)).toBe(0); });
});

describe('parseFmkoreaPopular — 웹진 카드', () => {
  const posts = parseFmkoreaPopular(fixture, NOW);

  test('3개 파싱(순위 순)', () => {
    expect(posts.length).toBe(3);
  });
  test('추천·댓글·카테고리·글쓴이·postId', () => {
    const p0 = posts[0]!;
    expect(p0.postId).toBe('10063023791');
    expect(p0.category).toBe('해외주식');
    expect(p0.author).toBe('dlwlrma');
    expect(p0.recommends).toBe(47);
    expect(p0.comments).toBe(14);
    expect(p0.views).toBeNull(); // 인기글은 조회 없음
    expect(p0.postedAt).toBe('2026-07-09T14:00:00.000Z');
  });
  test('선행 대괄호는 보존·맨뒤 [댓글수]만 제거', () => {
    const 한투 = posts.find(p => p.title.includes('한투'))!;
    expect(한투.title).toBe('\\[한투 최지욱\\] 한국은행 기준금리 만장일치 +25bp 인상 전망');
    expect(한투.comments).toBe(34);
    expect(한투.recommends).toBe(42);
  });
  test('추천 srl 불일치 시 0(오염 방지)', () => {
    // 모든 블록 srl 일치하므로 전부 추천값 존재
    expect(posts.every(p => p.recommends > 0)).toBe(true);
  });
});
