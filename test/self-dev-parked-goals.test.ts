import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCombinedParkedGoals } from '../src/self-dev/run-store.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'self-dev-parked-goals-'));
}

function runId(suffix: string): string {
  return `run-00000000-0000-0000-0000-${suffix.padStart(12, '0')}`;
}

function writeInterruptedLedger(ledgerDir: string, id: string, goalId: string | undefined, reason: string): void {
  writeFileSync(join(ledgerDir, `${id}.jsonl`), [
    { event: 'rework-budget', runId: id, goalId, timestamp: '2026-09-02T00:00:00.000Z', data: { verdict: 'UNCONVERGEABLE', reason } },
    { event: 'run-status', runId: id, goalId, timestamp: '2026-09-02T00:00:01.000Z', data: { runStatus: 'failed' } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
}

describe('listCombinedParkedGoals goal identity', () => {
  test('serializes distinct recorded goal IDs independently from failure reasons', () => {
    const ledgerDir = tmp();
    const first = runId('1');
    const second = runId('2');
    writeInterruptedLedger(ledgerDir, first, 'df558ee7870af1bd', 'gate failed after review');
    writeInterruptedLedger(ledgerDir, second, 'aabbccddeeff0011', 'gate failed after review');

    const rows = listCombinedParkedGoals({ dir: tmp(), ledgerDir }).parked;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.goalId)).toEqual(['df558ee7870af1bd', 'aabbccddeeff0011']);
    expect(new Set(rows.map((row) => row.goalId)).size).toBeGreaterThan(1);
    expect(rows.every((row) => row.goalId !== row.error?.message)).toBeTrue();
    expect(rows.every((row) => row.feature === row.error?.message)).toBeTrue();
  });

  test('uses null rather than a failure reason when the ledger has no unique goal ID', () => {
    const ledgerDir = tmp();
    const id = runId('3');
    const reason = 'cannot identify this goal from the ledger';
    writeInterruptedLedger(ledgerDir, id, undefined, reason);

    const row = listCombinedParkedGoals({ dir: tmp(), ledgerDir }).parked[0]!;

    expect(row.goalId).toBeNull();
    expect(row.feature).toBe(reason);
    expect(row.error?.message).toBe(reason);
  });

  test('self parked JSON reaches listCombinedParkedGoals and serializes goalId', () => {
    const stateDir = tmp();
    const ledgerDir = join(stateDir, 'run-ledger');
    mkdirSync(ledgerDir, { recursive: true });
    const id = runId('9');
    writeInterruptedLedger(ledgerDir, id, 'goal-cli-identity', 'CLI failure reason');

    const result = spawnSync('bun', ['bin/elanous.mjs', 'self', 'parked', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ELANOUS_DEBUG_LEVEL: 'off', ELANOUS_STATE_DIR: stateDir },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const listing = JSON.parse(result.stdout) as { parked: Array<{ runId: string; goalId: string | null; error?: { message: string } }> };
    const row = listing.parked.find((item) => item.runId === id)!;
    expect(Object.hasOwn(row, 'goalId')).toBeTrue();
    expect(row.goalId).toBe('goal-cli-identity');
    expect(row.goalId).not.toBe(row.error?.message);
  }, 60_000);

  test('self-dev checkpoint rows serialize a null goalId rather than a failure reason', () => {
    const stateDir = tmp();
    const runDir = join(stateDir, 'self-dev-runs');
    mkdirSync(runDir, { recursive: true });
    const id = runId('8');
    const reason = 'self-dev checkpoint failure reason';
    writeFileSync(join(runDir, `${id}.json`), JSON.stringify({
      runId: id,
      createdAt: 1,
      updatedAt: 2,
      results: [{ taskId: 'task-1', feature: 'original self-dev goal', status: 'failed', error: { code: 'FAILED', message: reason } }],
    }), 'utf8');

    const result = spawnSync('bun', ['bin/elanous.mjs', 'self', 'parked', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ELANOUS_DEBUG_LEVEL: 'off', ELANOUS_STATE_DIR: stateDir },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const listing = JSON.parse(result.stdout) as { parked: Array<{ runId: string; goalId: string | null; feature: string; error?: { message: string } }> };
    const row = listing.parked.find((item) => item.runId === id)!;
    expect(Object.hasOwn(row, 'goalId')).toBeTrue();
    expect(row.goalId).toBeNull();
    expect(row.goalId).not.toBe(row.error?.message);
    expect(row.feature).toBe('original self-dev goal');
  }, 60_000);

  test('keeps the measured UNCONVERGEABLE ledger stage and existing discriminator fields', () => {
    const ledgerDir = tmp();
    const id = runId('4');
    writeFileSync(join(ledgerDir, `${id}.jsonl`), [
      { event: 'abandoned-classification', runId: id, goalId: 'goal-discriminated', data: { classification: 'contract-conflict' } },
      { event: 'gated', runId: id, goalId: 'goal-discriminated', data: { introduced: 2, preexisting: 1 } },
      { event: 'review-cited-paths', runId: id, goalId: 'goal-discriminated', data: { missingCount: 3, ambiguousCount: 4 } },
      { event: 'rework-budget', runId: id, goalId: 'goal-discriminated', timestamp: '2026-09-02T00:00:00.000Z', data: { verdict: 'UNCONVERGEABLE', reason: 'still blocked' } },
      { event: 'run-status', runId: id, goalId: 'goal-discriminated', timestamp: '2026-09-02T00:00:01.000Z', data: { runStatus: 'failed' } },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');

    const row = listCombinedParkedGoals({ dir: tmp(), ledgerDir }).parked[0]!;

    expect(row).toMatchObject({
      goalId: 'goal-discriminated',
      stage: 'UNCONVERGEABLE',
      ledgerAbandonedClassification: 'contract-conflict',
      ledgerGatedCounts: { introduced: 2, preexisting: 1 },
      ledgerReviewCitedPathCounts: { missing: 3, ambiguous: 4 },
      laterRunSucceeded: false,
    });
  });
});
