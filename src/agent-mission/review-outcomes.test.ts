// G9 학습루프 — 무인 리뷰 결정 결과 추적 테스트. :memory: db + 순수 집계.
import { describe, test, expect } from 'bun:test';
import {
  openReviewOutcomeDb, recordMerge, updateOutcome, queryReviewStats, aggregateStats,
  findFollowups, detectFollowups,
} from './review-outcomes.js';

describe('review_outcomes store', () => {
  test('recordMerge → merged · updateOutcome → reverted', () => {
    const db = openReviewOutcomeDb(':memory:');
    recordMerge(db, '100', 'light', 't1');
    let stats = queryReviewStats(db);
    expect(stats.light.merged).toBe(1);
    expect(stats.light.bad).toBe(0);

    updateOutcome(db, '100', 'reverted', 't2');
    stats = queryReviewStats(db);
    expect(stats.light.merged).toBe(0); // merged→reverted 로 이동
    expect(stats.light.bad).toBe(1);
    expect(stats.light.regressionRate).toBe(1);
    db.close();
  });

  test('depth 별 분리 집계', () => {
    const db = openReviewOutcomeDb(':memory:');
    recordMerge(db, '1', 'light', 't');
    recordMerge(db, '2', 'light', 't');
    recordMerge(db, '3', 'heavy', 't');
    updateOutcome(db, '2', 'reverted', 't'); // light 1개 회귀
    const s = queryReviewStats(db);
    expect(s.light.merged).toBe(1);
    expect(s.light.bad).toBe(1);
    expect(s.light.regressionRate).toBe(0.5);
    expect(s.heavy.merged).toBe(1);
    expect(s.heavy.regressionRate).toBe(0);
    expect(s.total).toBe(3);
    db.close();
  });

  test('같은 PR 재머지 → 갱신(중복 아님)', () => {
    const db = openReviewOutcomeDb(':memory:');
    recordMerge(db, '100', 'light', 't1');
    recordMerge(db, '100', 'heavy', 't2'); // depth 갱신
    const s = queryReviewStats(db);
    expect(s.total).toBe(1);
    expect(s.heavy.merged).toBe(1);
    expect(s.light.merged).toBe(0);
    db.close();
  });
});

describe('aggregateStats (순수)', () => {
  test('followup-fixed 도 bad 로', () => {
    const s = aggregateStats([
      { depth: 'light', outcome: 'merged', n: 8 },
      { depth: 'light', outcome: 'reverted', n: 1 },
      { depth: 'light', outcome: 'followup-fixed', n: 1 },
    ]);
    expect(s.light.merged).toBe(8);
    expect(s.light.bad).toBe(2);
    expect(s.light.regressionRate).toBeCloseTo(0.2);
  });

  test('빈 입력 → 0 회귀율(나눗셈 0 방지)', () => {
    const s = aggregateStats([]);
    expect(s.light.regressionRate).toBe(0);
    expect(s.heavy.regressionRate).toBe(0);
    expect(s.total).toBe(0);
  });
});

describe('findFollowups (순수 FU 감지)', () => {
  const A = { pr: '100', files: ['src/x.ts'], mergedAt: '2026-07-22T10:00:00Z' };

  test('머지 후 같은 파일 수정 PR → followup', () => {
    const recent = [{ pr: '101', files: ['src/x.ts'], mergedAt: '2026-07-22T12:00:00Z', title: 'fix: x 보완' }];
    expect(findFollowups([A], recent)).toEqual(['100']);
  });

  test('다른 파일 수정 → followup 아님', () => {
    const recent = [{ pr: '101', files: ['src/y.ts'], mergedAt: '2026-07-22T12:00:00Z', title: 'feat: y' }];
    expect(findFollowups([A], recent)).toEqual([]);
  });

  test('revert PR 은 제외(G10 reverted 로 별도 기록)', () => {
    const recent = [{ pr: '101', files: ['src/x.ts'], mergedAt: '2026-07-22T12:00:00Z', title: 'revert: PR #100 회귀' }];
    expect(findFollowups([A], recent)).toEqual([]);
  });

  test('A 이전 머지 PR 은 제외(시간 순서)', () => {
    const recent = [{ pr: '99', files: ['src/x.ts'], mergedAt: '2026-07-22T08:00:00Z', title: 'fix' }];
    expect(findFollowups([A], recent)).toEqual([]);
  });

  test('자기 자신은 제외', () => {
    const recent = [{ pr: '100', files: ['src/x.ts'], mergedAt: '2026-07-22T12:00:00Z', title: 'self' }];
    expect(findFollowups([A], recent)).toEqual([]);
  });
});

describe('detectFollowups (store 갱신·gh 주입)', () => {
  test('merged → followup-fixed 갱신·통계 반영', () => {
    const db = openReviewOutcomeDb(':memory:');
    recordMerge(db, '100', 'light', '2026-07-22T10:00:00Z', ['src/x.ts']);
    const gh = () => JSON.stringify([
      { number: 100, files: [{ path: 'src/x.ts' }], mergedAt: '2026-07-22T10:00:00Z', title: '원 PR' },
      { number: 101, files: [{ path: 'src/x.ts' }], mergedAt: '2026-07-22T12:00:00Z', title: 'fix: x 보완' },
    ]);
    const fus = detectFollowups(db, { gh, now: 't' });
    expect(fus).toEqual(['100']);
    const s = queryReviewStats(db);
    expect(s.light.merged).toBe(0);
    expect(s.light.bad).toBe(1); // followup-fixed = bad
    db.close();
  });

  test('gh 실패 → 빈 결과(fail-soft)', () => {
    const db = openReviewOutcomeDb(':memory:');
    recordMerge(db, '100', 'light', 't', ['src/x.ts']);
    const gh = () => { throw new Error('gh down'); };
    expect(detectFollowups(db, { gh, now: 't' })).toEqual([]);
    db.close();
  });
});
