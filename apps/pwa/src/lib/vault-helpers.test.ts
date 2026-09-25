// Vault 헬퍼(OP3) 단위테스트 — 순수 함수.
import { describe, test, expect } from 'bun:test';
import { parseOutline, activeWikilinkQuery, insertWikilink, noteBasename, layoutForce } from './vault-helpers.js';

describe('parseOutline', () => {
  test('heading 추출 + 코드펜스 제외', () => {
    const md = '# A\n일반\n## B\n```\n# not-heading\n```\n### C';
    const o = parseOutline(md);
    expect(o.map(h => h.text)).toEqual(['A', 'B', 'C']);
    expect(o[0]!.level).toBe(1);
    expect(o[2]!.level).toBe(3);
  });
});

describe('activeWikilinkQuery', () => {
  test('미완성 [[partial 감지', () => {
    const text = '보라 [[Daily/2026';
    const r = activeWikilinkQuery(text, text.length);
    expect(r).not.toBeNull();
    expect(r!.query).toBe('Daily/2026');
    expect(r!.start).toBe(5);
  });
  test('닫힌 wikilink → null', () => {
    const text = '보라 [[Note]] 뒤';
    expect(activeWikilinkQuery(text, text.length)).toBeNull();
  });
  test('개행 넘으면 → null', () => {
    expect(activeWikilinkQuery('[[a\nb', 5)).toBeNull();
  });
  test('[[ 없음 → null', () => {
    expect(activeWikilinkQuery('plain text', 5)).toBeNull();
  });
});

describe('insertWikilink', () => {
  test('부분 교체 + ]] 부착', () => {
    const text = '보라 [[Dai';
    const q = activeWikilinkQuery(text, text.length)!;
    const r = insertWikilink(text, q.start, text.length, 'Daily Note');
    expect(r.text).toBe('보라 [[Daily Note]]');
    expect(r.caret).toBe(r.text.length);
  });
});

describe('noteBasename', () => {
  test('경로+확장자 제거', () => {
    expect(noteBasename('Daily/2026-07-09.md')).toBe('2026-07-09');
    expect(noteBasename('Note.md')).toBe('Note');
  });
});

describe('layoutForce', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  test('결정론 — 동일 입력 동일 출력(SSR 안전)', () => {
    const l1 = layoutForce(ids, edges, { width: 400, height: 300, iterations: 30 });
    const l2 = layoutForce(ids, edges, { width: 400, height: 300, iterations: 30 });
    expect(l1.map(n => [Math.round(n.x), Math.round(n.y)])).toEqual(l2.map(n => [Math.round(n.x), Math.round(n.y)]));
  });
  test('노드 수·경계·degree', () => {
    const l = layoutForce(ids, edges, { width: 400, height: 300, iterations: 30 });
    expect(l.length).toBe(4);
    for (const n of l) { expect(n.x).toBeGreaterThanOrEqual(20); expect(n.x).toBeLessThanOrEqual(380); expect(n.y).toBeGreaterThanOrEqual(20); expect(n.y).toBeLessThanOrEqual(280); }
    expect(l.find(n => n.id === 'b')!.deg).toBe(2); // b: a-b, b-c
    expect(l.find(n => n.id === 'd')!.deg).toBe(0);
  });
  test('빈 그래프 → 빈 배열', () => {
    expect(layoutForce([], [], { width: 400, height: 300 })).toEqual([]);
  });
});
