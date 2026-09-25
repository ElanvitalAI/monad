import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunLedgerEntry, RunLedgerLookup, RunLedgerLookupOptions } from '../self-implement/run-ledger.js';
import { queryGoalStatus, queryPausedGoalStatuses } from './resume-supervisor.js';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function transition(goalId: string, runId: string, timestamp: string, from: string, to: string, reason = ''): RunLedgerEntry {
  return { timestamp, runId, goalId, event: 'goal-status', data: { producer: 'goal-loop', runIdSource: 'goal-self', from, to, reason } };
}

function lookup(current: RunLedgerLookup['matches'], federated: RunLedgerLookup['matches']): (runId: string, options: RunLedgerLookupOptions) => RunLedgerLookup {
  let sawCurrent = false;
  return (runId, options) => {
    expect(runId).toBe('g-target');
    if (options.all) {
      expect(sawCurrent).toBe(true);
      return { matches: federated };
    }
    sawCurrent = true;
    return { matches: current };
  };
}

describe('queryGoalStatus', () => {
  test('selects the latest valid transition from federation and isolates the requested goal', () => {
    const result = queryGoalStatus('g-target', {
      lookup: lookup([], [
        { runId: 'g-target', ledgerDirectory: '/current/run-ledger', ledgerPath: '/current/run-ledger/g-target.jsonl', targetName: 'current', entries: [transition('g-target', 'g-target', '2026-08-17T00:00:00.000Z', 'active', 'paused'), transition('g-other', 'g-target', '2026-08-17T03:00:00.000Z', 'active', 'complete')] },
        { runId: 'g-target', ledgerDirectory: '/alternate/run-ledger', ledgerPath: '/alternate/run-ledger/g-target.jsonl', targetName: 'alternate', entries: [transition('g-target', 'g-target', '2026-08-17T02:00:00.000Z', 'active', 'budget-limited', 'budget-exhausted')] },
      ]),
    });
    expect(result).toMatchObject({ found: true, goalId: 'g-target', status: 'budget-limited', transitionedAt: '2026-08-17T02:00:00.000Z', reason: 'budget-exhausted', runId: 'g-target', origin: { ledgerPath: '/alternate/run-ledger/g-target.jsonl' } });
  });

  test('does not enumerate default ledgers when lookup is injected without a list snapshot', () => {
    const isolated = [{ runId: 'g-target', ledgerDirectory: '/isolated', ledgerPath: '/isolated/run-id.jsonl', targetName: 'isolated', entries: [
      transition('g-target', 'run-id', '2026-08-17T01:00:00.000Z', 'active', 'paused', 'human-stop'),
    ] }];
    expect(queryGoalStatus('g-target', {
      lookup: () => ({ matches: isolated }),
      list: () => { throw new Error('default ledger enumeration must not run for injected lookup'); },
    })).toMatchObject({
      found: true,
      goalId: 'g-target',
      status: 'paused',
      transitionedAt: '2026-08-17T01:00:00.000Z',
      reason: 'human-stop',
      runId: 'run-id',
      origin: { ledgerPath: '/isolated/run-id.jsonl' },
    });
  });

  test('reports unknown separately and ignores malformed status, state transition, and provenance records', () => {
    const result = queryGoalStatus('g-target', {
      lookup: lookup([], [{ runId: 'g-target', ledgerDirectory: '/current', ledgerPath: '/current/g-target.jsonl', targetName: null, entries: [
        transition('g-target', 'g-target', '2026-08-17T00:00:00.000Z', 'active', 'unknown'),
        transition('g-target', 'g-target', '2026-08-17T00:01:00.000Z', 'unknown', 'complete'),
        { timestamp: '2026-08-17T01:00:00.000Z', runId: 'g-target', goalId: 'g-target', event: 'goal-status', data: { producer: 'other', runIdSource: 'goal-self', from: 'active', to: 'complete', reason: '' } } as unknown as RunLedgerEntry,
      ] }]),
    });
    expect(result).toEqual({ found: false, goalId: 'g-target', kind: 'not-found' });
  });

  test('deduplicates replicated transitions by durable content and retains origins for true ambiguity', () => {
    const replicated = transition('g-target', 'g-target', '2026-08-17T00:00:00.000Z', 'active', 'paused');
    const deduplicated = queryGoalStatus('g-target', {
      lookup: lookup([], [
        { runId: 'g-target', ledgerDirectory: '/one', ledgerPath: '/one/g-target.jsonl', targetName: 'one', entries: [replicated] },
        { runId: 'g-target', ledgerDirectory: '/two', ledgerPath: '/two/g-target.jsonl', targetName: 'two', entries: [replicated] },
      ]),
    });
    expect(deduplicated).toMatchObject({ found: true, status: 'paused', origin: { ledgerPath: '/one/g-target.jsonl' } });

    const ambiguous = queryGoalStatus('g-target', {
      lookup: lookup([], [
        { runId: 'g-target', ledgerDirectory: '/one', ledgerPath: '/one/g-target.jsonl', targetName: 'one', entries: [transition('g-target', 'g-target', '2026-08-17T01:00:00.000Z', 'active', 'paused')] },
        { runId: 'g-target', ledgerDirectory: '/two', ledgerPath: '/two/g-target.jsonl', targetName: 'two', entries: [transition('g-target', 'g-target', '2026-08-17T01:00:00.000Z', 'active', 'complete')] },
      ]),
    });
    expect(ambiguous).toMatchObject({ found: false, kind: 'ambiguous', transitionedAt: '2026-08-17T01:00:00.000Z', candidates: [
      { status: 'paused', runId: 'g-target', origin: { targetName: 'one', ledgerPath: '/one/g-target.jsonl' } },
      { status: 'complete', runId: 'g-target', origin: { targetName: 'two', ledgerPath: '/two/g-target.jsonl' } },
    ] });
  });
});

describe('queryPausedGoalStatuses', () => {
  test('uses default filesystem enumeration across current and federated mixed filenames', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'paused-goals-ledgers-'));
    const federatedDir = mkdtempSync(join(tmpdir(), 'paused-goals-federated-'));
    const currentLedgerDir = join(stateDir, 'run-ledger');
    const federatedLedgerDir = join(federatedDir, 'run-ledger');
    const targets = [
      { name: 'current', dbPath: join(stateDir, 'logs', 'logs.db') },
      { name: 'federated', dbPath: join(federatedDir, 'logs', 'logs.db') },
    ];
    try {
      mkdirSync(currentLedgerDir, { recursive: true });
      mkdirSync(federatedLedgerDir, { recursive: true });
      writeFileSync(join(currentLedgerDir, 'goal-paused.jsonl'), `${JSON.stringify(transition('goal-paused', 'goal-paused', '2026-08-17T00:00:00.000Z', 'active', 'active', 'initial-state'))}\n`);
      const runId = 'run-12345678-1234-1234-1234-123456789abc';
      writeFileSync(join(currentLedgerDir, `${runId}.jsonl`), `${JSON.stringify(transition('goal-paused', runId, '2026-08-17T05:00:00.000Z', 'active', 'paused', 'human-stop'))}\n`);
      writeFileSync(join(currentLedgerDir, 'goal-resumed.jsonl'), [
        transition('goal-resumed', 'goal-resumed', '2026-08-17T01:00:00.000Z', 'active', 'paused'),
        transition('goal-resumed', 'goal-resumed', '2026-08-17T02:00:00.000Z', 'paused', 'active'),
      ].map((entry) => JSON.stringify(entry)).join('\n'));
      const federatedRunId = 'run-87654321-1234-1234-1234-123456789abc';
      writeFileSync(join(federatedLedgerDir, `${federatedRunId}.jsonl`), [
        transition('goal-complete', federatedRunId, '2026-08-17T03:00:00.000Z', 'active', 'complete'),
        transition('goal-federated-paused', federatedRunId, '2026-08-17T04:00:00.000Z', 'active', 'paused', 'operator-stop'),
      ].map((entry) => JSON.stringify(entry)).join('\n'));
      const options = { targets };
      const previousStateDir = process.env.MONAD_STATE_DIR;
      process.env.MONAD_STATE_DIR = stateDir;
      try {
        const result = queryPausedGoalStatuses(options);
        expect(result).toMatchObject([
          { goalId: 'goal-federated-paused', status: 'paused', transitionedAt: '2026-08-17T04:00:00.000Z', runId: federatedRunId },
          { goalId: 'goal-paused', status: 'paused', transitionedAt: '2026-08-17T05:00:00.000Z', reason: 'human-stop', runId },
        ]);
        for (const paused of result) expect(queryGoalStatus(paused.goalId, options)).toMatchObject({
          found: true,
          goalId: paused.goalId,
          status: paused.status,
          transitionedAt: paused.transitionedAt,
          reason: paused.reason,
          runId: paused.runId,
          origin: { ledgerPath: paused.origin.ledgerPath },
        });
      } finally {
        if (previousStateDir === undefined) delete process.env.MONAD_STATE_DIR;
        else process.env.MONAD_STATE_DIR = previousStateDir;
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(federatedDir, { recursive: true, force: true });
    }
  });


  test('combines injected current and federated snapshots once without ID lookup or re-enumeration', () => {
    const current: RunLedgerLookup['matches'] = [
      { runId: 'run-current', ledgerDirectory: '/current', ledgerPath: '/current/run-current.jsonl', targetName: 'current', entries: [
        transition('goal-current-paused', 'run-current', '2026-08-17T01:00:00.000Z', 'active', 'paused', 'human-stop'),
        transition('goal-current-active', 'run-current', '2026-08-17T02:00:00.000Z', 'paused', 'active'),
      ] },
    ];
    const federated: RunLedgerLookup['matches'] = [
      { runId: 'run-federated', ledgerDirectory: '/federated', ledgerPath: '/federated/run-federated.jsonl', targetName: 'federated', entries: [
        transition('goal-federated-paused', 'run-federated', '2026-08-17T03:00:00.000Z', 'active', 'paused', 'operator-stop'),
      ] },
    ];
    const calls: boolean[] = [];
    const listLedgers = (options: RunLedgerLookupOptions): RunLedgerLookup => {
      calls.push(options.all === true);
      return { matches: options.all ? federated : current };
    };
    const result = queryPausedGoalStatuses({
      lookup: () => { throw new Error('paused-list must not perform an ID lookup'); },
      listLedgers,
    });
    expect(calls).toEqual([false, true]);
    expect(result).toMatchObject([
      { goalId: 'goal-current-paused', status: 'paused', transitionedAt: '2026-08-17T01:00:00.000Z', runId: 'run-current', origin: { ledgerPath: '/current/run-current.jsonl' } },
      { goalId: 'goal-federated-paused', status: 'paused', transitionedAt: '2026-08-17T03:00:00.000Z', runId: 'run-federated', origin: { ledgerPath: '/federated/run-federated.jsonl' } },
    ]);
    expect(calls).toEqual([false, true]);
    const snapshot = [...current, ...federated];
    for (const paused of result) expect(queryGoalStatus(paused.goalId, {
      lookup: () => ({ matches: snapshot }),
      listLedgers: () => ({ matches: snapshot }),
    })).toEqual(paused);
  });

  test('returns an empty list for empty directories and propagates default enumeration failures', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'paused-goals-empty-'));
    const federatedDir = mkdtempSync(join(tmpdir(), 'paused-goals-empty-federated-'));
    const targets = [
      { name: 'current', dbPath: join(stateDir, 'logs', 'logs.db') },
      { name: 'federated', dbPath: join(federatedDir, 'logs', 'logs.db') },
    ];
    try {
      mkdirSync(join(stateDir, 'run-ledger'), { recursive: true });
      mkdirSync(join(federatedDir, 'run-ledger'), { recursive: true });
      const previousStateDir = process.env.MONAD_STATE_DIR;
      process.env.MONAD_STATE_DIR = stateDir;
      try {
        expect(queryPausedGoalStatuses({ targets })).toEqual([]);
        rmSync(join(stateDir, 'run-ledger'), { recursive: true, force: true });
        writeFileSync(join(stateDir, 'run-ledger'), 'not a directory');
        expect(() => queryPausedGoalStatuses()).toThrow('unable to list run ledger directory');
      } finally {
        if (previousStateDir === undefined) delete process.env.MONAD_STATE_DIR;
        else process.env.MONAD_STATE_DIR = previousStateDir;
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(federatedDir, { recursive: true, force: true });
    }
  });
});

describe('monad self goal-status process boundary', () => {
  test('a fresh CLI process reads a transition written by a completed registry process', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'goal-status-cli-'));
    try {
      const producer = spawnSync('bun', ['-e', "import { startGoal, setStatus } from './src/goals/registry.ts'; const started = startGoal({ objective: 'boundary' }); if (!started.ok) throw new Error('start failed'); setStatus('complete', 'done'); console.log(started.goal.id);"], { cwd: sourceRoot, encoding: 'utf8', env: { ...process.env, MONAD_STATE_DIR: stateDir } });
      expect(producer.status).toBe(0);
      const goalId = producer.stdout.trim();
      const reader = spawnSync('bun', [join(sourceRoot, 'bin/monad.mjs'), 'self', 'goal-status', goalId, '--json'], { cwd: sourceRoot, encoding: 'utf8', env: { ...process.env, MONAD_STATE_DIR: stateDir } });
      expect(reader.status).toBe(0);
      expect(JSON.parse(reader.stdout)).toMatchObject({ found: true, goalId, status: 'complete', reason: 'done' });
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  }, 60_000);

  test('the CLI returns structured not-found JSON with exit 1 when no durable transition exists', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'goal-status-cli-missing-'));
    try {
      const result = spawnSync('bun', [join(sourceRoot, 'bin/monad.mjs'), 'self', 'goal-status', 'g-missing', '--json'], { cwd: sourceRoot, encoding: 'utf8', env: { ...process.env, MONAD_STATE_DIR: stateDir } });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({ found: false, goalId: 'g-missing', kind: 'not-found' });
      expect(result.stderr).not.toContain('goal status not found');
    } finally { rmSync(stateDir, { recursive: true, force: true }); }
  }, 60_000);
});
