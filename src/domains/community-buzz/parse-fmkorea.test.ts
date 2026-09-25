// fmkorea 파서 단위테스트 — 라이브 캡처 픽스처(무네트워크).
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFmkoreaList, parseKoreanNumber } from './parse-fmkorea.js';

const fixture = readFileSync(join(import.meta.dir, '__fixtures__/fmkorea-list.md'), 'utf-8');

describe('parseKoreanNumber', () => {
  test('만/백만/천 단위', () => {
    expect(parseKoreanNumber('213')).toBe(213);
    expect(parseKoreanNumber('92만')).toBe(920_000);
    expect(parseKoreanNumber('1백만')).toBe(1_000_000);
    expect(parseKoreanNumber('2.9천')).toBe(2_900);
    expect(parseKoreanNumber('0')).toBe(0);
  });
  test('빈/무효 → null', () => {
    expect(parseKoreanNumber('')).toBeNull();
    expect(parseKoreanNumber('  ')).toBeNull();
  });
});

describe('parseFmkoreaList — 라이브 픽스처', () => {
  const posts = parseFmkoreaList(fixture);

  test('공지 제외하고 실글만', () => {
    expect(posts.length).toBe(5);
    expect(posts.every(p => p.category !== '공지')).toBe(true);
  });

  test('첫 글 필드 정확', () => {
    const p = posts[0]!;
    expect(p.postId).toBe('10063957503');
    expect(p.category).toBe('국내주식');
    expect(p.title).toContain('하닉 평단');
    expect(p.author).toBe('요미');
    expect(p.timeLabel).toBe('22:53');
    expect(p.views).toBe(0);
    expect(p.recommends).toBe(0);
    expect(p.url).toBe('https://www.fmkorea.com/10063957503');
  });

  test('조회수·추천수 파싱', () => {
    const 야선 = posts.find(p => p.title.includes('야선'))!;
    expect(야선.views).toBe(213);
    const 샌디스크 = posts.find(p => p.title.includes('샌디스크'))!;
    expect(샌디스크.recommends).toBe(1);
  });

  test('카테고리로 국내/해외 구분', () => {
    expect(posts.filter(p => p.category === '국내주식').length).toBe(3);
    expect(posts.filter(p => p.category === '해외주식').length).toBe(1);
    expect(posts.filter(p => p.category === '잡담').length).toBe(1);
  });

  test('은어 제목 원문 보존(정규화는 P1.5)', () => {
    // 하닉·야선·외궈·본주 등 은어는 파서가 건드리지 않고 그대로 넘긴다
    expect(posts.some(p => p.title.includes('외궈'))).toBe(true);
  });
});
