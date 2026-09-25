import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as prReviewer from '../agent-substrate/pr-reviewer.js';
import { debug } from '../debug/log.js';
import { defaultSeams } from './seams.js';

const SIGNAL_BODY = '조건 = grep -n \'acceptance\' src/self-implement/seams.ts; 관측 = 리뷰 호출 블록; 기대 = 1줄 이상';
const PRESERVED_REVIEW_DONE_KEYS = [
  'verdict', 'reviewed', 'mustFix', 'shouldFix', 'gateEvidenceLines', 'reviewerContextLoaded',
] as const;

describe('defaultSeams.reviewDiff — 골 판정 신호를 reviewPullRequest.acceptance 로 잇는다', () => {
  const received: Array<Record<string, unknown>> = [];
  let spy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
    received.length = 0;
  });

  function captureReviewInput(): void {
    spy = spyOn(prReviewer, 'reviewPullRequest').mockImplementation(async (input) => {
      received.push({ ...input });
      return { verdict: 'pass', mustFix: [], shouldFix: [], reviewed: true };
    });
  }

  test('판정 신호가 있는 골은 그 본문을 비어 있지 않은 acceptance 로 넘긴다', async () => {
    captureReviewInput();
    const seams = defaultSeams({
      llmReview: async () => 'VERDICT: PASS',
      reviewScopeDiff: async () => '+changed',
    });
    await seams.reviewDiff!('/tmp/review-acceptance-present', {
      goal: `## 판정 신호\n${SIGNAL_BODY}`,
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.acceptance).toContain(SIGNAL_BODY);
    expect(String(received[0]!.acceptance).length).toBeGreaterThan(0);
  });

  test('골이 없거나 판정 신호를 못 뽑으면 acceptance 키 자체가 없다', async () => {
    captureReviewInput();
    const seams = defaultSeams({
      llmReview: async () => 'VERDICT: PASS',
      reviewScopeDiff: async () => '+changed',
    });
    await seams.reviewDiff!('/tmp/review-acceptance-absent-goal');
    await seams.reviewDiff!('/tmp/review-acceptance-empty-signal', {
      goal: '## WHAT TO BUILD\n리뷰 입력만 잇는다',
    });
    expect(received).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(received[0], 'acceptance')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(received[1], 'acceptance')).toBe(false);
    expect(received[0]).not.toHaveProperty('acceptance');
    expect(received[1]).not.toHaveProperty('acceptance');
  });
});

describe('defaultSeams.reviewDiff — review.done 판정 신호 관측', () => {
  const events: Array<Record<string, unknown>> = [];
  let reviewSpy: ReturnType<typeof spyOn> | undefined;
  let logSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    reviewSpy?.mockRestore();
    logSpy?.mockRestore();
    reviewSpy = undefined;
    logSpy = undefined;
    events.length = 0;
  });

  function captureReviewDone(): void {
    reviewSpy = spyOn(prReviewer, 'reviewPullRequest').mockImplementation(async () => ({
      verdict: 'pass', mustFix: [], shouldFix: [], reviewed: true,
    }));
    logSpy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'self-implement' && event === 'review.done') events.push({ ...(data ?? {}) });
    }) as never);
  }

  test('골 없음·판정 신호 없음·판정 신호 있음이 review.done 에서 갈리고 본문은 안 실린다', async () => {
    captureReviewDone();
    const seams = defaultSeams({
      llmReview: async () => 'VERDICT: PASS',
      reviewScopeDiff: async () => '+changed',
    });
    const longSignal = 'x'.repeat(500);
    await seams.reviewDiff!('/tmp/review-done-absent-goal');
    await seams.reviewDiff!('/tmp/review-done-empty-signal', {
      goal: '## WHAT TO BUILD\n리뷰 입력만 잇는다',
    });
    await seams.reviewDiff!('/tmp/review-done-present-signal', {
      goal: `## 판정 신호\n${longSignal}`,
    });
    expect(events).toHaveLength(3);
    const [noGoal, noSignal, withSignal] = events;
    for (const event of events) {
      for (const key of PRESERVED_REVIEW_DONE_KEYS) expect(event).toHaveProperty(key);
      expect(typeof event.goalLoaded === 'boolean' || typeof event.goalLoaded === 'number').toBe(true);
      expect(typeof event.acceptanceChars).toBe('number');
    }
    expect(noGoal).toMatchObject({ goalLoaded: false, acceptanceChars: 0 });
    expect(noSignal).toMatchObject({ goalLoaded: true, acceptanceChars: 0 });
    expect(withSignal).toMatchObject({ goalLoaded: true });
    expect(Number(withSignal!.acceptanceChars)).toBeGreaterThan(0);
    expect(noGoal).not.toEqual(noSignal);
    expect(noSignal).not.toEqual(withSignal);
    expect(JSON.stringify(withSignal)).not.toContain(longSignal);
  });
});
