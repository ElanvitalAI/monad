import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { runPtyControlLoop, type ControlDecision, type PtyControlDeps, type PtyControlOpts } from '../src/autopilot/pty-control-loop.js';
import { snapshotRunLifecycle, validateLifecycleRecord } from '../src/signal/lifecycle-record.js';
import { resetLifecycleSequencesForTesting } from '../src/signal/lifecycle-sequence.js';
import { publishGoalLifecycle } from '../src/goals/loop.js';
import { ChannelBus } from '../src/terminal-matrix/channel-bus.js';

const original = {
  runId: process.env.ELANOUS_RUN_ID,
  ptyId: process.env.ELANOUS_PTY_ID,
  depth: process.env.ELANOUS_NEST_DEPTH,
};

function identity(): void {
  process.env.ELANOUS_RUN_ID = 'run-supervisor';
  process.env.ELANOUS_PTY_ID = 'pty-parent';
  process.env.ELANOUS_NEST_DEPTH = '2';
}

function restore(): void {
  for (const [key, value] of Object.entries({ ELANOUS_RUN_ID: original.runId, ELANOUS_PTY_ID: original.ptyId, ELANOUS_NEST_DEPTH: original.depth })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetLifecycleSequencesForTesting();
}

afterEach(restore);

function sequence(values: Array<'owned' | 'lost' | 'unknown'>): () => 'owned' | 'lost' | 'unknown' {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function deps(bus: ChannelBus, controlStance: PtyControlDeps['controlStance'], extra: Partial<PtyControlDeps> = {}): PtyControlDeps {
  return {
    observe: () => 'screen', inject: () => true, controlStance, classify: () => 'working', sleep: async () => {},
    subjectPtyId: 'pty-child', lifecycleBus: bus, ...extra,
  };
}

async function run(
  bus: ChannelBus,
  controlStance: PtyControlDeps['controlStance'],
  extra: Partial<PtyControlDeps> = {},
  decide: () => ControlDecision = () => ({ action: 'done', reason: 'complete' }),
  opts: PtyControlOpts = {},
) {
  return runPtyControlLoop({ decide }, deps(bus, controlStance, extra), { maxSteps: 2, pollMs: 0, ...opts });
}

describe('PTY ownership-lent lifecycle declaration', () => {
  test('confirmed loss publishes one valid parent declaration about its distinct child', async () => {
    identity();
    const bus = new ChannelBus();
    const result = await run(bus, () => 'lost');
    expect(result).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
    const records = snapshotRunLifecycle(bus, 'run-supervisor');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ptyId: 'pty-parent', subjectPtyId: 'pty-child', role: 'parent', class: 'condition', name: 'ownership-lent', transition: 'enter', resumable: false, payload: { actor: 'human', mode: 'manual' }, truncated: false });
    expect(records[0]!.ptyId).not.toBe(records[0]!.subjectPtyId);
    expect(validateLifecycleRecord(records[0])).toBeNull();
  });

  test('unknown publishes nothing while confirmed loss does publish', async () => {
    identity();
    const unknownBus = new ChannelBus();
    await run(unknownBus, () => 'unknown');
    expect(snapshotRunLifecycle(unknownBus, 'run-supervisor')).toEqual([]);
    const lostBus = new ChannelBus();
    await run(lostBus, () => 'lost');
    expect(snapshotRunLifecycle(lostBus, 'run-supervisor')).toHaveLength(1);
  });

  test('enter is resumable exactly when the ownership wait is enabled', async () => {
    identity();
    const resumableBus = new ChannelBus();
    await run(resumableBus, () => 'lost', { awaitOwnership: { maxWaitMs: 1 }, watchIntervalMs: 1 });
    const resumable = snapshotRunLifecycle(resumableBus, 'run-supervisor')[0]!;
    expect(resumable.class === 'condition' && resumable.transition === 'enter' && resumable.resumable).toBe(true);
    const terminalBus = new ChannelBus();
    await run(terminalBus, () => 'lost');
    const terminal = snapshotRunLifecycle(terminalBus, 'run-supervisor')[0]!;
    expect(terminal.class === 'condition' && terminal.transition === 'enter' && terminal.resumable).toBe(false);
  });

  test('returning ownership publishes one exit after one enter despite repeated lost probes', async () => {
    identity();
    const bus = new ChannelBus();
    let time = 0;
    const result = await run(bus, sequence(['lost', 'lost', 'lost', 'owned']), {
      awaitOwnership: { maxWaitMs: 4 }, watchIntervalMs: 1, now: () => time, sleep: async (ms) => { time += ms; },
    });
    expect(result.termination).toEqual({ kind: 'success', reason: 'complete' });
    const records = snapshotRunLifecycle(bus, 'run-supervisor');
    expect(records.map((record) => record.class === 'condition' ? record.transition : undefined)).toEqual(['enter', 'exit']);
    expect(records.every((record) => validateLifecycleRecord(record) === null)).toBe(true);
  });

  test('deadline expiry does not publish a false exit', async () => {
    identity();
    const bus = new ChannelBus();
    let time = 0;
    await run(bus, () => 'lost', {
      awaitOwnership: { maxWaitMs: 1 },
      watchIntervalMs: 1,
      now: () => time,
      sleep: async (ms) => { time += ms; },
    });
    expect(snapshotRunLifecycle(bus, 'run-supervisor').map((record) => record.class === 'condition' ? record.transition : undefined)).toEqual(['enter']);
  });

  test('failed probe does not publish a false exit', async () => {
    identity();
    const bus = new ChannelBus();
    await run(bus, sequence(['lost', 'unknown']), { awaitOwnership: { maxWaitMs: 3 }, watchIntervalMs: 1 });
    expect(snapshotRunLifecycle(bus, 'run-supervisor').map((record) => record.class === 'condition' ? record.transition : undefined)).toEqual(['enter']);
  });

  test('missing identity or subject skips publication without changing the loop result', async () => {
    identity();
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    try {
      const missingSubjectBus = new ChannelBus();
      const missingSubject = await runPtyControlLoop({ decide: () => ({ action: 'done' as const, reason: 'complete' }) }, {
        observe: () => 'screen', inject: () => true, controlStance: () => 'lost', lifecycleBus: missingSubjectBus,
      });
      expect(missingSubject).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(snapshotRunLifecycle(missingSubjectBus, 'run-supervisor')).toEqual([]);
      delete process.env.ELANOUS_RUN_ID;
      const missingIdentityBus = new ChannelBus();
      const missingIdentity = await run(missingIdentityBus, () => 'lost');
      expect(missingIdentity).toEqual({ termination: { kind: 'cancelled' }, steps: 0 });
      expect(missingIdentityBus.channels()).toEqual([]);
      const skips = log.mock.calls.filter(([category, event]) => category === 'signal' && event === 'lifecycle.skip-no-identity');
      expect(skips.map(([, , data]) => data)).toEqual([
        { missing: ['subjectPtyId'] },
        { missing: ['runId'] },
      ]);
    } finally {
      log.mockRestore();
    }
  });

  test('two producer modules share a strictly increasing producer sequence', async () => {
    identity();
    const bus = new ChannelBus();
    publishGoalLifecycle(bus, 'started');
    await run(bus, () => 'lost');
    const records = snapshotRunLifecycle(bus, 'run-supervisor');
    expect(records.map((record) => record.seq)).toEqual([1, 2]);
    expect(new Set(records.map((record) => `${record.ptyId}:${record.seq}`)).size).toBe(2);
  });

  test('throwing bus leaves termination and step count unchanged', async () => {
    identity();
    const baseline = await run(new ChannelBus(), () => 'lost');
    const throwingBus = { publish: () => { throw new Error('offline'); } } as unknown as ChannelBus;
    const withFailure = await run(throwingBus, () => 'lost');
    expect(withFailure).toEqual(baseline);
  });

  test('publication failures do not perturb a resumable ownership wait', async () => {
    identity();
    const waitEnds: Array<unknown> = [];
    const log = spyOn(debug, 'log').mockImplementation((category, event, data) => {
      if (category === 'autopilot.control' && event === 'ownership-wait-end') waitEnds.push(data);
    });
    const execute = async (bus: ChannelBus) => {
      let cadenceCalls = 0;
      let decisions = 0;
      const result = await run(
        bus,
        sequence(['lost', 'owned']),
        {
          awaitOwnership: { maxWaitMs: 4 },
          watchIntervalMs: 1,
          now: () => 0,
          sleep: async () => { cadenceCalls += 1; },
        },
        () => decisions++ === 0 ? { action: 'wait' } : { action: 'done', reason: 'complete' },
      );
      return { result, cadenceCalls, waitEnd: waitEnds.pop() };
    };
    try {
      const healthyBus = new ChannelBus();
      const healthy = await execute(healthyBus);
      expect(healthy.result.termination).toEqual({ kind: 'success', reason: 'complete' });
      expect(healthy.result.steps).toBeGreaterThan(0);
      expect(snapshotRunLifecycle(healthyBus, 'run-supervisor').map((record) => record.class === 'condition' ? record.transition : undefined)).toEqual(['enter', 'exit']);
      expect(healthy.waitEnd).toMatchObject({ ended: 'resumed', stance: 'owned' });

      const alwaysThrowingBus = { publish: () => { throw new Error('offline'); } } as unknown as ChannelBus;
      const alwaysThrowing = await execute(alwaysThrowingBus);
      expect(alwaysThrowing.result).toEqual(healthy.result);
      expect(alwaysThrowing.waitEnd).toEqual(healthy.waitEnd);
      expect(alwaysThrowing.cadenceCalls).toBe(healthy.cadenceCalls);

      const successfulTransitions: string[] = [];
      const failedTransitions: string[] = [];
      const exitThrowingBus = {
        publish: (_channel: string, message: { meta?: { transition?: string } }) => {
          const transition = message.meta?.transition;
          if (transition === 'exit') {
            failedTransitions.push(transition);
            throw new Error('offline');
          }
          if (transition) successfulTransitions.push(transition);
        },
      } as unknown as ChannelBus;
      const exitThrowing = await execute(exitThrowingBus);
      expect(successfulTransitions).toEqual(['enter', 'enter']);
      expect(failedTransitions).toEqual(['exit', 'exit']);
      expect(exitThrowing.result).toEqual(healthy.result);
      expect(exitThrowing.waitEnd).toEqual(healthy.waitEnd);
      expect(exitThrowing.cadenceCalls).toBe(healthy.cadenceCalls);
    } finally {
      log.mockRestore();
    }
  });
});
