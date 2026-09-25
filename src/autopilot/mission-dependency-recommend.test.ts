// S2(부분완주+의존미션 2026-07-19) — 의존 추천 트리거·제안 문구 순수 로직 검증.
import { test, expect, describe } from 'bun:test';
import { isDependencyRecommendTrigger, formatDependencyProposal } from './mission-dependency-recommend.js';

describe('isDependencyRecommendTrigger — escalate/skip 만 의존 추천', () => {
  test('escalate/skip → true(선행 의존 강함·부분 완주)', () => {
    expect(isDependencyRecommendTrigger('escalate')).toBe(true);
    expect(isDependencyRecommendTrigger('skip')).toBe(true);
  });
  test('split(S3 아크수술)·기타는 false(다른 대응)', () => {
    for (const p of ['retry-discipline', 'retry-budget', 'split', 'revise'] as const) {
      expect(isDependencyRecommendTrigger(p)).toBe(false);
    }
  });
});

describe('formatDependencyProposal — 제안 문구(순수·ASCII+한글)', () => {
  test('페이즈명·근거·carve/재개 안내 포함', () => {
    const s = formatDependencyProposal('의존 페이즈', '선행 스키마 미구현');
    expect(s).toContain('의존 페이즈');
    expect(s).toContain('선행 스키마');
    expect(s).toContain('carve');
    expect(s).toContain('재개');
    expect(s).toContain('부분 완주');
  });
  test('근거 없으면 기본 문구·긴 입력 slice', () => {
    const s = formatDependencyProposal('T'.repeat(100), '');
    expect(s).toContain('선행 조건 미충족');
    expect(s.length).toBeLessThan(320);
  });
  test('개행/공백 정규화', () => {
    const s = formatDependencyProposal('제목', '여러\n줄\t근거');
    expect(s).toContain('여러 줄 근거');
  });
});
