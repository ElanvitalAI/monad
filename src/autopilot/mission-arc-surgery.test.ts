// S3(in-flight 아크 수술 2026-07-19) — 과대 판정 트리거·제안 문구 순수 로직 검증.
import { test, expect, describe } from 'bun:test';
import { isArcSurgeryTrigger, formatArcSurgeryProposal } from './mission-arc-surgery.js';

describe('isArcSurgeryTrigger — split 만 수술 제안', () => {
  test('split → true(범위 과대·분할 대상)', () => {
    expect(isArcSurgeryTrigger('split')).toBe(true);
  });
  test('그 외 결정은 false(다른 대응)', () => {
    for (const p of ['retry-discipline', 'retry-budget', 'revise', 'skip', 'escalate'] as const) {
      expect(isArcSurgeryTrigger(p)).toBe(false);
    }
  });
});

describe('formatArcSurgeryProposal — 제안 문구(순수·ASCII+한글)', () => {
  test('페이즈명·근거·수습 방법 포함', () => {
    const s = formatArcSurgeryProposal('큰 페이즈', '관심사 5클래스 결합');
    expect(s).toContain('큰 페이즈');
    expect(s).toContain('관심사 5클래스');
    expect(s).toContain('inject --arc');
    expect(s).toContain('분할 권장');
  });
  test('근거 없으면 기본 문구·긴 입력은 slice', () => {
    const s = formatArcSurgeryProposal('T'.repeat(100), '');
    expect(s).toContain('범위 과대');
    expect(s.length).toBeLessThan(300); // title 60 + rationale 160 상한
  });
  test('개행/공백 정규화', () => {
    const s = formatArcSurgeryProposal('제목', '여러\n줄\t근거');
    expect(s).toContain('여러 줄 근거');
  });
});
