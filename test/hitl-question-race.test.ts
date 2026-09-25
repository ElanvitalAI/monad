// requestQuestion multi-channel race tests — M5 of PLAN-ask-user-
// question-cross-surface-2026-05-13.
//
// Validates:
// • First-answering channel wins, losers get cancel() called
// • Channels returning null (unconfigured) drop out of the race
// • Timeout fallback resolves with `cancelled: true`
// • Empty channel list returns `'all-failed'` immediately
// • Thrown channel errors swallow into all-failed (best-effort)

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_QUESTION_TIMEOUT_MS,
  requestQuestion,
  type QuestionChannel,
} from '../src/hitl/question.js';
import type { AskUserQuestionRequest, AskUserQuestionResult } from '../src/ask-user-question/types.js';

const sampleReq: AskUserQuestionRequest = {
  questions: [
    {
      id: 'pick',
      header: 'Pick',
      question: 'Choose one',
      options: [
        { label: 'A', description: 'first' },
        { label: 'B', description: 'second' },
      ],
    },
  ],
};

function makeChannel(
  name: string,
  opts: { result?: AskUserQuestionResult | null; delayMs?: number; throws?: boolean } = {},
): QuestionChannel & { cancelCalls: number } {
  let cancelCalls = 0;
  return {
    name,
    async ask() {
      if (opts.throws) throw new Error('channel broken');
      if (opts.delayMs) {
        await new Promise((res) => setTimeout(res, opts.delayMs));
      }
      return opts.result === undefined ? { answers: { pick: 'A' } } : opts.result;
    },
    cancel() {
      cancelCalls += 1;
    },
    get cancelCalls() { return cancelCalls; },
  } as QuestionChannel & { cancelCalls: number };
}

describe('requestQuestion happy path', () => {
  test('returns first channel to answer', async () => {
    const fast = makeChannel('fast', { result: { answers: { pick: 'A' } }, delayMs: 10 });
    const slow = makeChannel('slow', { result: { answers: { pick: 'B' } }, delayMs: 100 });
    const r = await requestQuestion({ request: sampleReq, channels: [fast, slow] });
    expect(r.channel).toBe('fast');
    expect(r.result.answers).toEqual({ pick: 'A' });
    // Slow loses — should be cancelled.
    // Need a tick for the cancelOthers Promise.allSettled to run.
    await new Promise((res) => setTimeout(res, 20));
    expect(slow.cancelCalls).toBe(1);
    expect(fast.cancelCalls).toBe(0);
  });

  test('forwards otherText + cancelled flag from channel result', async () => {
    const ch = makeChannel('only', {
      result: {
        answers: { pick: 'Other' },
        otherText: { pick: 'custom' },
        cancelled: false,
      },
    });
    const r = await requestQuestion({ request: sampleReq, channels: [ch] });
    expect(r.result.otherText).toEqual({ pick: 'custom' });
    // requestQuestion passes the channel result through verbatim (the
    // coerce → omit pass happens on the server in `coerceAskResult`).
    expect(r.result.cancelled).toBe(false);
  });
});

describe('requestQuestion drop-out semantics', () => {
  test('null-returning channel is dropped, others still race', async () => {
    const dropped = makeChannel('dropped', { result: null });
    const winner = makeChannel('winner', { result: { answers: { pick: 'A' } }, delayMs: 20 });
    const r = await requestQuestion({ request: sampleReq, channels: [dropped, winner] });
    expect(r.channel).toBe('winner');
    // null-returning channel doesn't get cancel() (never settled · not winner).
    // Actually we cancel everyone except winner — dropped will get cancel() too.
    await new Promise((res) => setTimeout(res, 20));
    expect(dropped.cancelCalls).toBe(1);
    expect(winner.cancelCalls).toBe(0);
  });

  test('all channels return null → resolves to timeout fallback', async () => {
    const a = makeChannel('a', { result: null });
    const b = makeChannel('b', { result: null });
    const r = await requestQuestion({
      request: sampleReq,
      channels: [a, b],
      timeoutMs: 50,
    });
    expect(r.channel).toBe('timeout');
    expect(r.result.cancelled).toBe(true);
    expect(r.result.answers).toEqual({});
  });
});

describe('requestQuestion error paths', () => {
  test('thrown channel → all-failed', async () => {
    const broken = makeChannel('broken', { throws: true });
    const r = await requestQuestion({ request: sampleReq, channels: [broken], timeoutMs: 200 });
    expect(r.channel).toBe('all-failed');
    expect(r.result.cancelled).toBe(true);
  });

  test('empty channel list returns all-failed immediately', async () => {
    const r = await requestQuestion({ request: sampleReq, channels: [] });
    expect(r.channel).toBe('all-failed');
    expect(r.elapsedMs).toBeLessThan(50);   // didn't wait for timeout
  });
});

describe('requestQuestion timeout', () => {
  test('honors custom timeout', async () => {
    const slow = makeChannel('slow', { result: { answers: { pick: 'A' } }, delayMs: 200 });
    const r = await requestQuestion({
      request: sampleReq,
      channels: [slow],
      timeoutMs: 30,
    });
    expect(r.channel).toBe('timeout');
    expect(r.result.cancelled).toBe(true);
    expect(r.elapsedMs).toBeLessThan(100);   // exited before slow's 200ms
    expect(r.elapsedMs).toBeGreaterThanOrEqual(30);
    // Slow channel gets cancel().
    await new Promise((res) => setTimeout(res, 10));
    expect(slow.cancelCalls).toBe(1);
  });

  test('custom onTimeout override', async () => {
    const slow = makeChannel('slow', { result: { answers: { pick: 'A' } }, delayMs: 200 });
    const r = await requestQuestion({
      request: sampleReq,
      channels: [slow],
      timeoutMs: 20,
      onTimeout: () => ({ answers: { pick: 'A' }, cancelled: false }),
    });
    expect(r.channel).toBe('timeout');
    expect(r.result.answers).toEqual({ pick: 'A' });
    expect(r.result.cancelled).toBe(false);
  });
});

describe('requestQuestion default constants', () => {
  test('DEFAULT_QUESTION_TIMEOUT_MS is 120s', () => {
    expect(DEFAULT_QUESTION_TIMEOUT_MS).toBe(120_000);
  });
});
