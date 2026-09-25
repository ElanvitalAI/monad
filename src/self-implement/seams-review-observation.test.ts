import { test, expect, describe, spyOn } from 'bun:test';
import { debug } from '../debug/log.js';
import { defaultSeams } from './seams.js';

function captureReviewDone() {
  const events: Record<string, unknown>[] = [];
  const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
    if (event === 'review.done') events.push(data ?? {});
  }) as never);
  return { events, restore: () => log.mockRestore() };
}

describe('defaultSeams.reviewDiff — failureReason observation', () => {
  test('reviewed=false ⊕ failureReason 인 리뷰 결과는 review.done 관측에 그 사유를 담는다', async () => {
    const { events, restore } = captureReviewDone();
    try {
      const seams = defaultSeams({
        llmReview: async () => { throw new Error('reviewer unavailable'); },
        reviewScopeDiff: async () => '+changed',
      });
      await seams.reviewDiff!('/tmp/review-failure-reason-obs');
    } finally {
      restore();
    }
    expect(events).toEqual([expect.objectContaining({
      reviewed: false,
      failureReason: 'reviewer unavailable',
    })]);
  });

  test('같은 경우 reviewDiff 반환 객체에도 그 사유가 담긴다', async () => {
    const { restore } = captureReviewDone();
    try {
      const seams = defaultSeams({
        llmReview: async () => { throw new Error('reviewer unavailable'); },
        reviewScopeDiff: async () => '+changed',
      });
      const review = await seams.reviewDiff!('/tmp/review-failure-reason-return');
      expect(review.reviewed).toBe(false);
      expect(review.failureReason).toBe('reviewer unavailable');
    } finally {
      restore();
    }
  });

  test('failureReason 이 없으면 관측 payload 와 반환 객체 모두 그 키가 없다', async () => {
    const { events, restore } = captureReviewDone();
    let review: Awaited<ReturnType<NonNullable<ReturnType<typeof defaultSeams>['reviewDiff']>>>;
    try {
      const seams = defaultSeams({
        llmReview: async () => 'VERDICT: PASS',
        reviewScopeDiff: async () => '+changed',
      });
      review = await seams.reviewDiff!('/tmp/review-failure-reason-absent');
    } finally {
      restore();
    }
    expect(events).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(events[0], 'failureReason')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(review, 'failureReason')).toBe(false);
  });

  test('reviewed=true 경로의 관측·반환 모양은 바뀌지 않는다', async () => {
    const { events, restore } = captureReviewDone();
    let review: Awaited<ReturnType<NonNullable<ReturnType<typeof defaultSeams>['reviewDiff']>>>;
    try {
      const seams = defaultSeams({
        llmReview: async () => 'VERDICT: PASS',
        reviewScopeDiff: async () => '+changed',
      });
      review = await seams.reviewDiff!('/tmp/review-failure-reason-pass');
    } finally {
      restore();
    }
    expect(events).toEqual([expect.objectContaining({
      verdict: 'pass', reviewed: true, mustFix: 0, shouldFix: 0,
    })]);
    expect(review).toMatchObject({
      verdict: 'pass', reviewed: true, mustFix: [], shouldFix: [],
    });
    expect(Object.prototype.hasOwnProperty.call(events[0], 'failureReason')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(review, 'failureReason')).toBe(false);
  });

  test('failureReason 이 있는 관측과 없는 관측의 키 목록은 서로 다르다', async () => {
    const { events, restore } = captureReviewDone();
    try {
      const failed = defaultSeams({
        llmReview: async () => { throw new Error('reviewer unavailable'); },
        reviewScopeDiff: async () => '+changed',
      });
      const passed = defaultSeams({
        llmReview: async () => 'VERDICT: PASS',
        reviewScopeDiff: async () => '+changed',
      });
      await failed.reviewDiff!('/tmp/review-failure-reason-keys-fail');
      await passed.reviewDiff!('/tmp/review-failure-reason-keys-pass');
    } finally {
      restore();
    }
    expect(events).toHaveLength(2);
    const withReason = Object.keys(events[0] ?? {}).sort();
    const withoutReason = Object.keys(events[1] ?? {}).sort();
    expect(withReason).toContain('failureReason');
    expect(withoutReason).not.toContain('failureReason');
    expect(withReason).not.toEqual(withoutReason);
  });
});
