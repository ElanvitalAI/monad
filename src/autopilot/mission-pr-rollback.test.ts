import { describe, it, expect } from 'bun:test';
import { extractPrNumber, collectPrUrls, rollbackPrs } from './mission-pr-rollback.js';

describe('extractPrNumber', () => {
  it('PR URL 에서 번호 추출', () => {
    expect(extractPrNumber('https://github.com/o/r/pull/3884')).toBe(3884);
  });
  it('PR URL 아니면 null', () => {
    expect(extractPrNumber('https://github.com/o/r/tree/main')).toBeNull();
  });
});

describe('collectPrUrls', () => {
  it('[SE-PR] 마커의 PR URL 만 수집(중복 제거)', () => {
    const notes = [
      ['[SE-PR] https://github.com/o/r/pull/1', '[CRITIQUE:FAIL] x'],
      ['[REBUILD] y', '[SE-PR] https://github.com/o/r/pull/2'],
      ['[SE-PR] https://github.com/o/r/pull/1'], // 중복
    ];
    expect(collectPrUrls(notes)).toEqual([
      'https://github.com/o/r/pull/1',
      'https://github.com/o/r/pull/2',
    ]);
  });
  it('[SE-PR] 없으면 빈 배열', () => {
    expect(collectPrUrls([['[ATTEMPT 1] x'], []])).toEqual([]);
  });
  it('PR URL 이 아닌 [SE-PR] 은 무시', () => {
    expect(collectPrUrls([['[SE-PR] (생성 실패)']])).toEqual([]);
  });
});

describe('rollbackPrs', () => {
  it('각 PR 을 closePr 로 닫고 성공 수 반환', () => {
    const closed: string[] = [];
    const r = rollbackPrs(['url/pull/1', 'url/pull/2'], (u) => { closed.push(u); return true; });
    expect(r).toEqual({ attempted: 2, closed: 2 });
    expect(closed).toEqual(['url/pull/1', 'url/pull/2']);
  });
  it('개별 실패는 건너뛰고 계속(fail-soft)', () => {
    const r = rollbackPrs(['a', 'b', 'c'], (u) => u !== 'b');
    expect(r).toEqual({ attempted: 3, closed: 2 });
  });
  it('closePr 예외도 삼킴(재실행 안 막음)', () => {
    const r = rollbackPrs(['a'], () => { throw new Error('gh 실패'); });
    expect(r).toEqual({ attempted: 1, closed: 0 });
  });
});
