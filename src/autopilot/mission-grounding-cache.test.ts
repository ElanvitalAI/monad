import { describe, it, expect } from 'bun:test';
import { hashGoal, isResearchFresh, isGroundingFresh, RESEARCH_TTL_MS, type GroundingCacheEntry } from './mission-grounding-cache.js';

const entry = (over: Partial<GroundingCacheEntry>): GroundingCacheEntry => ({ goalHash: hashGoal('goal'), ...over });
const NOW = 1_700_000_000_000;

describe('mission-grounding-cache freshness (순수·대표 2026-07-20)', () => {
  it('hashGoal — 골 동일(trim)=같은 해시·다르면 다른 해시', () => {
    expect(hashGoal('goal')).toBe(hashGoal(' goal '));
    expect(hashGoal('a')).not.toBe(hashGoal('b'));
  });

  describe('isResearchFresh — 골 동일 + 6h TTL', () => {
    it('6h 이내 → true(재사용)', () => {
      const e = entry({ research: { researched: true, enrichments: [], corrections: [], needReason: '' }, researchAt: new Date(NOW - 60_000).toISOString() });
      expect(isResearchFresh(e, 'goal', NOW)).toBe(true);
    });
    it('6h 초과 → false(재조사)', () => {
      const e = entry({ research: { researched: true, enrichments: [], corrections: [], needReason: '' }, researchAt: new Date(NOW - RESEARCH_TTL_MS - 1).toISOString() });
      expect(isResearchFresh(e, 'goal', NOW)).toBe(false);
    });
    it('골 다르면 → false', () => {
      const e = entry({ research: { researched: true, enrichments: [], corrections: [], needReason: '' }, researchAt: new Date(NOW).toISOString() });
      expect(isResearchFresh(e, 'other', NOW)).toBe(false);
    });
    it('research 없음/null → false', () => {
      expect(isResearchFresh(null, 'goal', NOW)).toBe(false);
      expect(isResearchFresh(entry({}), 'goal', NOW)).toBe(false);
    });
  });

  describe('isGroundingFresh — 골 동일 + 파일 스코프 SHA 동일(H5)', () => {
    it('파일 SHA 동일 → true(그 파일들 무변경·재사용)', () => {
      const e = entry({ grounding: { grounded: true, context: 'c', files: ['f'] }, groundingFilesSha: 'abc123' });
      expect(isGroundingFresh(e, 'goal', 'abc123')).toBe(true);
    });
    it('파일 SHA 다르면 → false(그 파일 변경·재조사)', () => {
      const e = entry({ grounding: { grounded: true, context: 'c', files: ['f'] }, groundingFilesSha: 'abc123' });
      expect(isGroundingFresh(e, 'goal', 'def456')).toBe(false);
    });
    it('SHA 빈값(git 실패) → false(안전·재조사)', () => {
      const e = entry({ grounding: { grounded: true, context: 'c', files: [] }, groundingFilesSha: 'abc123' });
      expect(isGroundingFresh(e, 'goal', '')).toBe(false);
    });
    it('★ deprecated groundingHeadSha 만 있는 옛 엔트리 → false(H5 이후 재조사·하위호환)', () => {
      const e = entry({ grounding: { grounded: true, context: 'c', files: ['f'] }, groundingHeadSha: 'abc123' });
      expect(isGroundingFresh(e, 'goal', 'abc123')).toBe(false);
    });
    it('grounding 없음/골 다름 → false', () => {
      expect(isGroundingFresh(entry({}), 'goal', 'abc')).toBe(false);
      const e = entry({ grounding: { grounded: true, context: 'c', files: [] }, groundingFilesSha: 'abc' });
      expect(isGroundingFresh(e, 'other', 'abc')).toBe(false);
    });
  });
});
