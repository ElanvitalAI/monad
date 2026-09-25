// ── TOX run-lifecycle scaffold tests (MSS M1.2 sub-PR #B) ──

import { describe, expect, test } from 'bun:test';

import {
  newRun,
  transitionRun,
  RUN_STATUSES,
  type RunRecord,
} from '../../src/task-orchestrator/run-lifecycle.ts';
import { asRunUri } from '../../src/mss/uri/builder.ts';

describe('newRun', () => {
  test('starts in the `started` state with a freshly minted RunUri', () => {
    const run = newRun();
    expect(run.status).toBe('started');
    expect(() => asRunUri(run.runId)).not.toThrow();
    expect(typeof run.startedAt).toBe('number');
    expect(run.endedAt).toBeUndefined();
  });

  test('artifacts arrays start empty', () => {
    const run = newRun();
    expect(run.artifacts.memoryWrites).toEqual([]);
    expect(run.artifacts.signalEmits).toEqual([]);
  });

  test('successive runs get distinct ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add(newRun().runId as string);
    expect(ids.size).toBe(25);
  });
});

describe('transitionRun', () => {
  test('started → running is legal', () => {
    const run = newRun();
    const next = transitionRun(run, 'running');
    expect(next.status).toBe('running');
    expect(next.endedAt).toBeUndefined();
  });

  test('running → completed records endedAt', () => {
    const run = transitionRun(newRun(), 'running');
    const done = transitionRun(run, 'completed');
    expect(done.status).toBe('completed');
    expect(typeof done.endedAt).toBe('number');
  });

  test('terminal states record endedAt', () => {
    const r1 = newRun();
    const r2 = transitionRun(r1, 'running');
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      const ended = transitionRun(r2, terminal);
      expect(ended.endedAt).toBeDefined();
    }
  });

  test('illegal transitions throw', () => {
    const completed = transitionRun(transitionRun(newRun(), 'running'), 'completed');
    expect(() => transitionRun(completed, 'running')).toThrow(/Illegal run transition/);
    expect(() => transitionRun(newRun(), 'completed')).toThrow(/Illegal run transition/);
  });

  test('original record is not mutated', () => {
    const run = newRun();
    transitionRun(run, 'running');
    expect(run.status).toBe('started');
  });
});

describe('RUN_STATUSES', () => {
  test('matches the documented closed set', () => {
    expect(new Set<string>(RUN_STATUSES)).toEqual(
      new Set(['started', 'running', 'completed', 'failed', 'cancelled'])
    );
  });
});

describe('RunRecord shape', () => {
  test('compile-time + runtime sanity for downstream consumers', () => {
    const r: RunRecord = newRun();
    // Pin the field set so M3+M4 capture pipelines can rely on it.
    expect(Object.keys(r).sort()).toEqual(['artifacts', 'runId', 'startedAt', 'status']);
  });
});
