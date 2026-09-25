import { describe, test, expect } from 'bun:test';
import { ellipsize } from './ellipsize.js';

describe('ellipsize', () => {
  test('max가 0 이하이면 빈 문자열을 반환한다', () => {
    expect(ellipsize('hello', 0)).toBe('');
    expect(ellipsize('hello', -1)).toBe('');
  });

  test('입력이 max 이하이면 원본 문자열을 반환한다', () => {
    expect(ellipsize('hello', 5)).toBe('hello');
    expect(ellipsize('hi', 5)).toBe('hi');
  });

  test('자르면 말줄임표를 포함해 max 글자 이내로 유지한다', () => {
    expect(ellipsize('hello world', 5)).toBe('hell…');
    expect(ellipsize('hello world', 1)).toBe('…');
  });
});
