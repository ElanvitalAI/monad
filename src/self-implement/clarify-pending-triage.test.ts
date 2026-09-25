import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { GoalRunStore } from './goal-run-store.js';
import { CLARIFY_PENDING_TRIAGE_CUTOFF, formatClarifyPendingPopulationScope, parseClarifyPendingCreatedAt, triageClarifyPending, type ClarifyPendingTriageInput } from './clarify-pending-triage.js';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface Row extends ClarifyPendingTriageInput {
  readonly id: string;
}

function row(id: string, kind: Row['status']['kind'], createdAt?: Date): Row {
  return { id, status: { kind }, createdAt };
}

describe('triageClarifyPending', () => {
  test('parses authored submitted dates and leaves absent or invalid metadata unknown', () => {
    expect(parseClarifyPendingCreatedAt('submitted: 2026-08-11 KST')?.toISOString()).toBe('2026-08-10T15:00:00.000Z');
    expect(parseClarifyPendingCreatedAt('submitted: invalid')).toBeUndefined();
    expect(parseClarifyPendingCreatedAt('submitted: 2026-02-30 KST')).toBeUndefined();
    expect(parseClarifyPendingCreatedAt('# Goal')).toBeUndefined();
  });

  test('formats the inspected current-instance populations and their read failures', () => {
    expect(formatClarifyPendingPopulationScope({
      goalRunStore: { path: '/state/self-implement/goal-runs.db', recordCount: 4, readFailed: false, missing: false },
      unfinishedRunLedger: { directory: '/state/run-ledger', entryCount: 2, unreadableLedgerCount: 1, directoryMissing: false, readFailed: false },
    })).toBe('scope: population goal-run-store path=/state/self-implement/goal-runs.db records=4 state=readable; unfinished-run-ledger directory=/state/run-ledger entries=2 state=1 ledger unreadable');
    expect(formatClarifyPendingPopulationScope({
      goalRunStore: { path: '/state/self-implement/goal-runs.db', recordCount: null, readFailed: true, missing: false },
      unfinishedRunLedger: { directory: null, entryCount: null, unreadableLedgerCount: null, directoryMissing: null, readFailed: true },
    })).toBe('scope: population goal-run-store path=/state/self-implement/goal-runs.db records=unavailable state=read-failed; unfinished-run-ledger directory=unavailable entries=unavailable state=read-failed');
  });

  test('reads population metadata and no-record status through the same store snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clarify-pending-snapshot-'));
    directories.push(directory);
    const store = new GoalRunStore(join(directory, 'goal-runs.db'));
    const missingGoal = join(directory, 'GOAL-missing.md');
    try {
      const snapshot = store.withPopulationSnapshot((population) => ({
        population,
        status: store.latestStatusByGoalFile(missingGoal, {
          unfinishedRunLedgers: {
            entries: [], ledgerDirectory: join(directory, 'run-ledger'), goalsDirectory: join(directory, 'goals'), unreadableLedgerCount: 0,
            ledgerDirectoryMissing: true, scope: 'self-implement-run-ledger', note: 'test fixture',
          },
        }),
      }));
      expect(snapshot).toEqual({
        population: { path: join(directory, 'goal-runs.db'), recordCount: 0, readFailed: false, missing: false },
        status: { kind: 'no-record' },
      });
    } finally {
      store.close();
    }
  });

  test('puts completed and abandoned finished runs in the past partition', () => {
    const completed = row('completed', 'finished', new Date('2026-08-14T00:00:00.000Z'));
    const abandoned = row('abandoned', 'finished', new Date('2026-08-14T00:00:00.000Z'));

    const result = triageClarifyPending([completed, abandoned]);

    expect(result.nowAnswerable).toEqual([]);
    expect(result.past).toEqual([completed, abandoned]);
  });

  test('uses the KST calendar date and keeps the cutoff day in the now-answerable partition', () => {
    const old = row('old', 'no-record', new Date('2026-08-10T14:59:59.999Z'));
    const boundary = row('boundary', 'no-record', new Date('2026-08-10T15:00:00.000Z'));
    const recent = row('recent', 'no-record', new Date('2026-08-11T15:00:00.000Z'));

    const result = triageClarifyPending([old, boundary, recent]);

    expect(CLARIFY_PENDING_TRIAGE_CUTOFF).toBe('2026-08-11');
    expect(result.past).toEqual([old]);
    expect(result.nowAnswerable).toEqual([boundary, recent]);
  });

  test('keeps missing or invalid dates and nonterminal statuses answerable without mutating inputs', () => {
    const missing = row('missing', 'no-record');
    const invalid = row('invalid', 'no-record', new Date(Number.NaN));
    const unfinished = row('unfinished', 'unfinished', new Date('2026-08-01T00:00:00.000Z'));
    const unavailable = row('unavailable', 'unavailable', new Date('2026-08-01T00:00:00.000Z'));
    const rows = [missing, invalid, unfinished, unavailable];

    const result = triageClarifyPending(rows);

    expect(result.nowAnswerable).toEqual(rows);
    expect(result.past).toEqual([]);
    expect(rows).toEqual([missing, invalid, unfinished, unavailable]);
  });

  test('CLI keeps an outside goal document reachable with a relative path', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'clarify-pending-outside-goals-'));
    const goalsDirectory = join(tmpdir(), 'clarify-pending-outside-goals-documents');
    directories.push(workingDirectory, goalsDirectory);
    const stateDirectory = join(workingDirectory, '.monad-test', 'state');
    mkdirSync(goalsDirectory, { recursive: true });
    writeFileSync(join(goalsDirectory, 'GOAL-outside.md'), [
      '# Outside',
      '- Clarification:',
      '  - id: outside',
      '  - header: Scope',
      '  - question: Choose a scope',
      '  - options:',
      '    - label: A',
      '      description: First scope',
      '  - includeOther: false',
      '  - answer: DEFERRED-UNTIL: Choose a scope',
    ].join('\n'));
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(process.cwd(), 'bin', 'monad.mjs'), `--test=${stateDirectory}`, 'self', 'clarify', 'pending', '--dir', goalsDirectory],
      cwd: workingDirectory,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const goalRows = result.stdout.toString().trim().split('\n').filter((line) => line.endsWith(' pending — outside — run: no-record'));
    expect(goalRows).toHaveLength(1);
    expect(goalRows[0]).toEndWith('GOAL-outside.md: 1 pending — outside — run: no-record');
    expect(isAbsolute(goalRows[0].split(':', 1)[0] ?? '')).toBeFalse();
  }, 60_000);

  test('CLI renders both partitions, preserves status suffixes, and leaves summary last', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'clarify-pending-triage-cli-'));
    directories.push(workingDirectory);
    const goalsDirectory = join(workingDirectory, 'docs', 'goals');
    const stateDirectory = join(workingDirectory, '.monad-test', 'state');
    mkdirSync(goalsDirectory, { recursive: true });
    const clarification = (id: string) => `- Clarification:\n  - id: ${id}\n  - header: Scope\n  - question: Choose a scope\n  - options:\n    - label: A\n      description: First scope\n  - includeOther: false\n  - answer: DEFERRED-UNTIL: Choose a scope`;
    const oldGoal = join(goalsDirectory, 'GOAL-old.md');
    const currentGoal = join(goalsDirectory, 'GOAL-current.md');
    writeFileSync(oldGoal, `# Old\n- GoalId: 0000000000000001\nsubmitted: 2026-08-10 KST\n${clarification('old')}`);
    writeFileSync(currentGoal, `# Current\n- GoalId: 0000000000000002\nsubmitted: 2026-08-11 KST\n${clarification('current')}`);
    const cli = join(process.cwd(), 'bin', 'monad.mjs');
    const result = Bun.spawnSync({
      cmd: [process.execPath, cli, `--test=${stateDirectory}`, 'self', 'clarify', 'pending'],
      cwd: workingDirectory,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const rows = result.stdout.toString().trim().split('\n');
    expect(rows).toEqual([
      'now answerable:',
      'docs/goals/GOAL-current.md: 1 pending — current — run: no-record',
      'past:',
      'docs/goals/GOAL-old.md: 1 pending — old — run: no-record',
      `summary: 2 goal documents scanned; 2 with unanswered clarifications — this lists records written in goal documents, not live waits; live waits: questions pending — scope: population goal-run-store path=${join(stateDirectory, 'self-implement', 'goal-runs.db')} records=0 state=missing; unfinished-run-ledger directory=${join(stateDirectory, 'run-ledger')} entries=0 state=missing`,
    ]);
    expect(rows.at(-1)).toMatch(/^summary: /);
  }, 60_000);
});
