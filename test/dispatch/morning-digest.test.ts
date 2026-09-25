// Phase 2 D7 — MorningDigestComposer unit tests.

import { describe, expect, test } from 'bun:test';

import {
  composeMorningDigest,
  type DigestRun,
  type MorningDigestInput,
} from '../../src/dispatch/morning-digest.ts';

function run(over: Partial<DigestRun>): DigestRun {
  return {
    taskId: 't',
    taskTitle: 'Task',
    outcome: 'completed',
    startedAt: 1000,
    endedAt: 2000,
    ...over,
  };
}

function makeInput(over: Partial<MorningDigestInput> = {}): MorningDigestInput {
  return {
    date: '2026-05-13',
    windowStart: '2026-05-12T22:00:00Z',
    windowEnd: '2026-05-13T07:00:00Z',
    runs: [],
    ...over,
  };
}

describe('composeMorningDigest counts', () => {
  test('tallies every outcome', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [
          run({ outcome: 'completed' }),
          run({ outcome: 'completed' }),
          run({ outcome: 'failed', errorSummary: 'timeout' }),
          run({ outcome: 'awaiting-approval' }),
          run({ outcome: 'retrying', errorSummary: 'flaky' }),
          run({ outcome: 'cancelled' }),
        ],
      }),
    );
    expect(out.counts).toEqual({
      completed: 2,
      failed: 1,
      awaitingApproval: 1,
      retrying: 1,
      cancelled: 1,
      total: 6,
    });
  });

  test('zero completed → summary says so', () => {
    const out = composeMorningDigest(makeInput({ runs: [run({ outcome: 'failed' })] }));
    expect(out.sections.summary).toContain('0 tasks completed');
  });
});

describe('composeMorningDigest sections', () => {
  test('completed section uses titles, retrying carries error', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [
          run({ taskTitle: 'Crawl X', outcome: 'completed' }),
          run({ taskTitle: 'Crawl Y', outcome: 'retrying', errorSummary: 'rate limited' }),
        ],
      }),
    );
    expect(out.sections.completed).toEqual(['Crawl X']);
    expect(out.sections.retrying[0]).toContain('Crawl Y (rate limited)');
  });

  test('upcoming plan rendered with optional slot tags', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [],
        upcoming: [
          { taskTitle: 'Morning omni-digest', expectedSlot: 'active' },
          { taskTitle: 'Background indexing' },
        ],
      }),
    );
    expect(out.sections.upcoming[0]).toContain('(slot: active)');
    expect(out.sections.upcoming[1]).toBe('Background indexing');
  });

  test('resource snapshot rolls up into a single line', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [],
        resources: { localLlmSeconds: 1800, apiCostUsd: 0.34, tokenTotal: 120_000 },
      }),
    );
    expect(out.sections.resourceSummary).toContain('local LLM');
    expect(out.sections.resourceSummary).toContain('API $0.34');
    expect(out.sections.resourceSummary).toContain('120,000 tokens');
  });
});

describe('Rendering', () => {
  test('plaintext is multi-line and includes greeting + summary', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [
          run({ taskTitle: 'A', outcome: 'completed' }),
          run({ taskTitle: 'B', outcome: 'awaiting-approval' }),
        ],
      }),
    );
    expect(out.plainText.split('\n')[0]).toContain('Good morning');
    expect(out.plainText).toContain('Completed:');
    expect(out.plainText).toContain('Awaiting your review:');
    expect(out.plainText).toContain('A');
    expect(out.plainText).toContain('B');
  });

  test('markdown has H1 header + emoji section headers', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [
          run({ taskTitle: 'A', outcome: 'completed' }),
          run({ taskTitle: 'B', outcome: 'failed', errorSummary: 'oom' }),
        ],
      }),
    );
    expect(out.markdown.startsWith('# Good morning · 2026-05-13')).toBe(true);
    expect(out.markdown).toContain('## ✅ Completed (1)');
    expect(out.markdown).toContain('## ❌ Failed (1)');
  });

  test('runtime total rolls up only completed runs', () => {
    const out = composeMorningDigest(
      makeInput({
        runs: [
          run({ outcome: 'completed', startedAt: 0, endedAt: 60_000 }),       // 1 min
          run({ outcome: 'completed', startedAt: 100, endedAt: 120_000 + 100 }), // 2 min
          run({ outcome: 'failed', startedAt: 0, endedAt: 10_000_000 }),       // ignored
        ],
      }),
    );
    expect(out.sections.summary).toContain('3 min');
  });
});

describe('Empty input', () => {
  test('all-zero digest still renders gracefully', () => {
    const out = composeMorningDigest(makeInput());
    expect(out.counts.total).toBe(0);
    expect(out.sections.completed).toEqual([]);
    expect(out.plainText).toContain('Good morning');
    expect(out.markdown).toContain('# Good morning');
  });
});
