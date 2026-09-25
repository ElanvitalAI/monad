import { describe, expect, test } from 'bun:test';
import {
  REWORK_FINDING_PERSISTENCE_DRIFT_THRESHOLD,
  buildReworkDriftRecommendation,
  detectReworkDrift,
  type ReworkVerdictReview,
} from './rework-drift-verdict.js';

const review = (round: number, mustFixCount: number, findingIds: readonly string[] | null, reviewVerdict: string | null = 'fail'): ReworkVerdictReview => ({ round, mustFixCount, findingIds, reviewVerdict });

describe('rework drift verdict', () => {
  test('uses named threshold: one carry-over is tolerated and two are drift', () => {
    expect(REWORK_FINDING_PERSISTENCE_DRIFT_THRESHOLD).toBe(2);
    expect(detectReworkDrift([
      review(1, 1, ['a']), review(2, 1, ['a']),
    ])).toMatchObject({ verdict: 'no-drift', maximumPersistenceCount: 1 });
    expect(detectReworkDrift([
      review(1, 1, ['a']), review(2, 1, ['a']), review(3, 1, ['a']),
    ])).toEqual({ verdict: 'drift', reason: 'persistent-must-fix', persistentFindingIds: ['a'], maximumPersistenceCount: 2 });
  });

  test('uses only the must-fix prefix of mixed findingIds', () => {
    const result = detectReworkDrift([
      review(1, 1, ['must-fix-a', 'should-fix-shared']),
      review(2, 1, ['must-fix-b', 'should-fix-shared']),
      review(3, 1, ['must-fix-c', 'should-fix-shared']),
    ]);
    expect(result).toMatchObject({ verdict: 'no-drift', maximumPersistenceCount: 0 });
  });

  test('resets a finding streak after an absent round instead of accumulating carry-overs', () => {
    expect(detectReworkDrift([
      review(1, 1, ['a']),
      review(2, 1, ['a']),
      review(3, 1, ['b']),
      review(4, 1, ['a']),
      review(5, 1, ['a']),
    ])).toEqual({
      verdict: 'no-drift',
      reason: 'no-persistent-must-fix',
      persistentFindingIds: [],
      maximumPersistenceCount: 1,
    });
  });

  test('does not compare a single review with itself', () => {
    expect(detectReworkDrift([review(1, 1, ['a'])])).toEqual({
      verdict: 'unmeasurable', reason: 'insufficient-review-rounds', persistentFindingIds: [], maximumPersistenceCount: null,
    });
  });

  test('keeps unavailable decisive axes unmeasurable', () => {
    expect(detectReworkDrift([]).reason).toBe('no-review-rounds');
    expect(detectReworkDrift([review(1, 0, [], 'pass'), review(2, 0, null, 'pass')])).toMatchObject({ verdict: 'unmeasurable', reason: 'finding-ids-unavailable' });
    expect(detectReworkDrift([review(1, 2, ['a'], 'fail'), review(2, 0, [], 'pass')])).toMatchObject({ verdict: 'unmeasurable', reason: 'finding-ids-unavailable' });
    expect(detectReworkDrift([review(1, 0, [], null), review(2, 0, [], 'pass')])).toMatchObject({ verdict: 'unmeasurable', reason: 'review-verdict-unavailable' });
  });

  test('builds HITL-only recommendations for every verdict', () => {
    for (const result of [
      detectReworkDrift([review(1, 1, ['a']), review(2, 1, ['a']), review(3, 1, ['a'])]),
      detectReworkDrift([review(1, 0, [], 'pass'), review(2, 0, [], 'pass')]),
      detectReworkDrift([]),
    ]) expect(buildReworkDriftRecommendation(result)).toContain('HITL');
  });
});
