// buildSkillHint — 하니스 결정론 skill 힌트 (H3 · 실행 안 함)

import { describe, test, expect } from 'bun:test';
import { buildSkillHint, SKILL_HINT_MIN_SCORE } from './skill-hint.js';
import type { SkillIndexEntry } from '../skills/index.js';

function entry(over: Partial<SkillIndexEntry>): SkillIndexEntry {
  return {
    name: 'omni-crawl', description: '웹 검색/크롤링 스킬', triggers: [], extractedTriggers: [],
    autoTrigger: false, category: 'research', skillDir: '/x',
    ...over,
  } as SkillIndexEntry;
}

describe('buildSkillHint — 보수 게이트', () => {
  const index = [
    entry({ name: 'omni-crawl', description: '웹 검색/크롤링', triggers: ['크롤링', '웹 검색', 'crawl'] }),
    entry({ name: 'diagram-master', description: '다이어그램 생성', triggers: ['다이어그램', 'diagram'] }),
  ];

  test('빈 objective / 빈 index → null', () => {
    expect(buildSkillHint('', index)).toBeNull();
    expect(buildSkillHint('크롤링 크롤링', [])).toBeNull();
  });

  test('강한 explicit 트리거 2회(score>=2.0·unambiguous) → 힌트', () => {
    // '크롤링'(1.0) + '웹 검색'(1.0) = 2.0, 단독 최고 → 힌트.
    const hint = buildSkillHint('이 데이터를 크롤링하고 웹 검색으로 보강해줘', index);
    expect(hint).not.toBeNull();
    expect(hint).toContain('omni-crawl');
    expect(hint).toContain('skill 힌트');
  });

  test('단일 explicit 트리거(score 1.0 < 2.0) → null(오탐 방지)', () => {
    expect(buildSkillHint('크롤링 한번 해볼까', index)).toBeNull();
  });

  test('트리거 무매칭(설명 단어만) → null', () => {
    // '생성' 은 어떤 트리거도 아님 → score 0 또는 설명보너스만 → 명시 트리거 0 → null.
    expect(buildSkillHint('함수를 생성해줘', index)).toBeNull();
  });

  test('동점(ambiguous) → null', () => {
    // 두 skill 각각 explicit 트리거 2회로 동점 → unambiguous=false → null.
    const idx2 = [
      entry({ name: 'a', triggers: ['foo', 'bar'] }),
      entry({ name: 'b', triggers: ['foo', 'bar'] }),
    ];
    expect(buildSkillHint('foo bar', idx2)).toBeNull();
  });

  test('임계 상수 = 2.0(shouldAutoRoute 정합)', () => {
    expect(SKILL_HINT_MIN_SCORE).toBe(2.0);
  });
});
