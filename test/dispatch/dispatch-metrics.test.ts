// D8 (2026-05-12) — Phase 2 dispatch metrics writer + reader.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aggregateDispatchRuns,
  dispatchDir,
  dispatchRunsPath,
  listDispatchRuns,
  parseDispatchRunLine,
  recordDispatchOutcome,
  RUNS_FILE,
  type DispatchRunRecord,
} from '../../src/dispatch/dispatch-metrics.ts';

const SAMPLE: DispatchRunRecord = {
  at: '2026-05-12T10:00:00.000Z',
  taskId: 'task:abc',
  outcome: 'launched',
  reason: 'ok',
  axes: {
    inSleepWindow: true,
    idle: true,
    resourceOk: true,
    priorityBoosted: false,
  },
};

describe('dispatch-metrics path resolution', () => {
  test('ELANOUS_DISPATCH_DIR env wins', () => {
    const prev = process.env.ELANOUS_DISPATCH_DIR;
    process.env.ELANOUS_DISPATCH_DIR = '/tmp/dispatch-x';
    try {
      expect(dispatchDir()).toBe('/tmp/dispatch-x');
      expect(dispatchRunsPath()).toBe(`/tmp/dispatch-x/${RUNS_FILE}`);
    } finally {
      if (prev === undefined) delete process.env.ELANOUS_DISPATCH_DIR;
      else process.env.ELANOUS_DISPATCH_DIR = prev;
    }
  });
});

describe('parseDispatchRunLine', () => {
  test('valid line → record', () => {
    expect(parseDispatchRunLine(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
  });

  test('empty / malformed / missing fields → null', () => {
    expect(parseDispatchRunLine('')).toBeNull();
    expect(parseDispatchRunLine('garbage')).toBeNull();
    expect(parseDispatchRunLine(JSON.stringify({ at: 'x' }))).toBeNull();
  });

  test('unknown outcome → null', () => {
    expect(
      parseDispatchRunLine(JSON.stringify({ ...SAMPLE, outcome: 'banana' })),
    ).toBeNull();
  });

  test('missing axes object → null', () => {
    const bad = { ...SAMPLE };
    delete (bad as Partial<DispatchRunRecord>).axes;
    expect(parseDispatchRunLine(JSON.stringify(bad))).toBeNull();
  });
});

describe('aggregateDispatchRuns', () => {
  test('empty list → zero aggregates', () => {
    const a = aggregateDispatchRuns([]);
    expect(a.total).toBe(0);
    expect(a.successRate).toBe(0);
    expect(a.byOutcome.launched).toBe(0);
  });

  test('rolls up success rate + reject reasons + sleep / idle splits', () => {
    const rows: DispatchRunRecord[] = [
      SAMPLE,
      { ...SAMPLE, taskId: 'b', outcome: 'rejected', reason: 'resource-budget:gpu' },
      { ...SAMPLE, taskId: 'c', outcome: 'rejected', reason: 'resource-budget:gpu' },
      { ...SAMPLE, taskId: 'd', outcome: 'rejected', reason: 'sleep-window:after-hours' },
      {
        ...SAMPLE, taskId: 'e', outcome: 'deferred',
        axes: { inSleepWindow: false, idle: false, resourceOk: true, priorityBoosted: false },
      },
    ];
    const a = aggregateDispatchRuns(rows);
    expect(a.total).toBe(5);
    expect(a.successRate).toBeCloseTo(1 / 5);
    expect(a.byOutcome).toEqual({ launched: 1, deferred: 1, rejected: 3, errored: 0 });
    expect(a.topRejectReasons[0]).toEqual({ reason: 'resource-budget:gpu', count: 2 });
    expect(a.sleepWindowSplit).toEqual({ inWindow: 4, awake: 1 });
    expect(a.idleSplit).toEqual({ idle: 4, busy: 1 });
  });
});

describe('recordDispatchOutcome + listDispatchRuns', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'd8-metrics-'));
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('writes JSONL row + reader returns it most-recent-first', () => {
    recordDispatchOutcome(SAMPLE, { resolveDir: () => tmp });
    recordDispatchOutcome({ ...SAMPLE, taskId: 'second' }, { resolveDir: () => tmp });
    const text = readFileSync(join(tmp, RUNS_FILE), 'utf8');
    expect(text.trim().split('\n').length).toBe(2);
    const res = listDispatchRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(2);
    expect(res.rows[0]!.taskId).toBe('second');
    expect(res.rows[1]!.taskId).toBe('task:abc');
  });

  test('limit caps surfaced rows; aggregates still see full file', () => {
    for (let i = 0; i < 5; i += 1) {
      recordDispatchOutcome({ ...SAMPLE, taskId: `r-${i}` }, { resolveDir: () => tmp });
    }
    const res = listDispatchRuns(2, { resolveDir: () => tmp });
    expect(res.total).toBe(5);
    expect(res.rows.length).toBe(2);
    expect(res.aggregates.total).toBe(5);
  });

  test('missing log file → empty result (not an error)', () => {
    const res = listDispatchRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(0);
    expect(res.rows).toEqual([]);
  });

  test('writer swallows resolveDir errors silently', () => {
    expect(() => {
      recordDispatchOutcome(SAMPLE, {
        resolveDir: () => { throw new Error('boom'); },
      });
    }).not.toThrow();
  });

  test('test seam appendLine bypasses fs', () => {
    const lines: string[] = [];
    recordDispatchOutcome(SAMPLE, {
      resolveDir: () => tmp,
      appendLine: (_path, line) => { lines.push(line); },
    });
    expect(lines.length).toBe(1);
    const res = listDispatchRuns(10, { resolveDir: () => tmp });
    expect(res.total).toBe(0);
  });
});
