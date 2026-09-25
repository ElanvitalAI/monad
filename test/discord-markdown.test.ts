// 디스코드 마크다운 렌더 보정 — GFM 테이블→정렬 코드블록, 수평선→유니코드 구분선.

import { describe, test, expect } from 'bun:test';
import { formatForDiscord } from '../src/discord-markdown.js';

describe('formatForDiscord', () => {
  test('GFM 테이블 → 정렬 코드블록', () => {
    const md = [
      '답변:',
      '| 이름 | 값 |',
      '| --- | --- |',
      '| 삼성 | 100 |',
      '| SK | 2200 |',
    ].join('\n');
    const out = formatForDiscord(md);
    expect(out).toContain('```'); // 코드블록으로 감쌈
    expect(out).toContain('│');    // 정렬 구분자
    expect(out).toContain('삼성');
    expect(out).not.toContain('| --- |'); // GFM 구분선 raw 제거
    // 코드블록 안에 정렬된 헤더+값.
    expect(out).toMatch(/```[\s\S]*이름[\s\S]*삼성[\s\S]*```/);
  });

  test('테이블 셀 안 마크다운 strip — 코드블록서 raw 기호 제거', () => {
    const md = [
      '| 종목 | 주가 |',
      '| --- | --- |',
      '| 삼성 | **253,500원** |',
      '| SK | `1,830,000` |',
    ].join('\n');
    const out = formatForDiscord(md);
    expect(out).toContain('253,500원');
    expect(out).not.toContain('**253,500원**');  // ** 벗김
    expect(out).not.toContain('`1,830,000`');     // 백틱 벗김
    expect(out).toContain('1,830,000');
  });

  test('수평선(---/***/___) → 유니코드 구분선', () => {
    expect(formatForDiscord('a\n---\nb')).toBe(`a\n${'─'.repeat(20)}\nb`);
    expect(formatForDiscord('a\n***\nb')).toContain('─'.repeat(20));
    expect(formatForDiscord('a\n___\nb')).toContain('─'.repeat(20));
  });

  test('테이블 아닌 파이프 텍스트는 무변경', () => {
    const t = '이것은 | 파이프가 있는 | 일반 문장';
    expect(formatForDiscord(t)).toBe(t); // 구분선 없으면 테이블 아님
  });

  test('일반 마크다운(bold/코드/리스트)은 무변경 — 디스코드 네이티브', () => {
    const md = '**볼드** `코드` 그리고\n- 리스트\n> 인용';
    expect(formatForDiscord(md)).toBe(md);
  });

  test('테이블 + 본문 혼합', () => {
    const md = '설명입니다.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n끝.';
    const out = formatForDiscord(md);
    expect(out).toContain('설명입니다.');
    expect(out).toContain('끝.');
    expect(out).toContain('```');
  });

  test('빈/단순 텍스트 무변경', () => {
    expect(formatForDiscord('안녕하세요')).toBe('안녕하세요');
    expect(formatForDiscord('')).toBe('');
  });
});
