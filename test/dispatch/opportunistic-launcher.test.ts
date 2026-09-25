// Phase 2 D5 — OpportunisticLauncher unit tests.

import { describe, expect, test } from 'bun:test';

import {
  OpportunisticLauncher,
  type LaunchCandidate,
  type LauncherDeps,
} from '../../src/dispatch/opportunistic-launcher.ts';
import { ResourceScheduler, type LocalLlmDecl } from '../../src/dispatch/resource-scheduler.ts';
import { IdleDetector } from '../../src/dispatch/idle-detector.ts';
import type { ResolvedSlot, SlotKind } from '../../src/dispatch/time-slot.ts';

const QWEN: LocalLlmDecl = {
  id: 'qwen-coder-72b',
  location: 'lmstudio',
  maxConcurrent: 1,
  capabilities: ['coding', 'reasoning'],
};

function slot(kind: SlotKind, overrides: Partial<ResolvedSlot['policy']> = {}): () => ResolvedSlot {
  return () => ({
    kind,
    policy: {
      noisyTasks: 'allow',
      longRunning: 'allow',
      apiCost: 'deny',
      pushFreq: 'high',
      ...overrides,
    },
    fromFallback: false,
  });
}

function makeCandidate(id: string, over: Partial<LaunchCandidate> = {}): LaunchCandidate {
  return {
    id,
    priorityRank: 5,
    ready: true,
    ...over,
  };
}

function launcher(opts: Partial<LauncherDeps> & Pick<LauncherDeps, 'readyTasks' | 'launch'>): OpportunisticLauncher {
  return new OpportunisticLauncher({
    slot: opts.slot ?? slot('active'),
    scheduler: opts.scheduler ?? new ResourceScheduler({ pool: [QWEN], slot: opts.slot ?? slot('active') }),
    readyTasks: opts.readyTasks,
    launch: opts.launch,
    ...(opts.idle !== undefined ? { idle: opts.idle } : {}),
    ...(opts.concurrencyOK !== undefined ? { concurrencyOK: opts.concurrencyOK } : {}),
    ...(opts.perTickCap !== undefined ? { perTickCap: opts.perTickCap } : {}),
    ...(opts.recordOutcome !== undefined ? { recordOutcome: opts.recordOutcome } : {}),
    ...(opts.inSleepWindow !== undefined ? { inSleepWindow: opts.inSleepWindow } : {}),
  });
}

describe('OpportunisticLauncher.tick — basic', () => {
  test('launches ready tasks in priority order', async () => {
    const launched: string[] = [];
    const l = launcher({
      readyTasks: () => [
        makeCandidate('t-1', { priorityRank: 5 }),
        makeCandidate('t-0', { priorityRank: 1 }),
        makeCandidate('t-2', { priorityRank: 3 }),
      ],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    await l.tick();
    expect(launched).toEqual(['t-0', 't-2', 't-1']);
  });

  test('skips !ready tasks', async () => {
    const launched: string[] = [];
    const l = launcher({
      readyTasks: () => [
        makeCandidate('t-blocked', { ready: false, priorityRank: 1 }),
        makeCandidate('t-ok', { priorityRank: 2 }),
      ],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    await l.tick();
    expect(launched).toEqual(['t-ok']);
  });

  test('respects perTickCap', async () => {
    const launched: string[] = [];
    const l = launcher({
      perTickCap: 2,
      readyTasks: () => [
        makeCandidate('a'),
        makeCandidate('b'),
        makeCandidate('c'),
      ],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    await l.tick();
    expect(launched.length).toBe(2);
  });
});

describe('Slot gating', () => {
  test('preferredSlot mismatch is skipped', async () => {
    const launched: string[] = [];
    const l = launcher({
      slot: slot('active'),
      readyTasks: () => [makeCandidate('night-only', { preferredSlot: 'sleep' })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toContain('slot-mismatch');
  });

  test('noisy task denied in focused-work slot', async () => {
    const launched: string[] = [];
    const l = launcher({
      slot: slot('focused-work', { noisyTasks: 'deny' }),
      readyTasks: () => [makeCandidate('hot', { noisy: true })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toBe('slot:noisyTasks=deny');
  });

  test('longRunning task denied when slot policy says so', async () => {
    const launched: string[] = [];
    const l = launcher({
      slot: slot('focused-work', { longRunning: 'deny' }),
      readyTasks: () => [makeCandidate('slow', { longRunning: true })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toBe('slot:longRunning=deny');
  });

  test('idle preferredSlot requires the idle detector', async () => {
    const launched: string[] = [];
    const detector = new IdleDetector({ thresholdMs: 1000, now: () => 0 });
    detector.notifyActivity('chat'); // user is active
    const l = launcher({
      slot: slot('idle'),
      idle: detector,
      readyTasks: () => [makeCandidate('chore', { preferredSlot: 'idle' })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toBe('not-idle');
  });
});

describe('Resource axis', () => {
  test('skips when ResourceScheduler refuses', async () => {
    const sched = new ResourceScheduler({ pool: [QWEN], slot: slot('active') });
    sched.tryReserve({ taskId: 'busy', capabilities: ['coding'] }); // saturate
    const launched: string[] = [];
    const l = launcher({
      slot: slot('active'),
      scheduler: sched,
      readyTasks: () => [makeCandidate('t', { capabilities: ['coding'] })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toContain('resource:');
  });

  test('reservation hands off to launch when available', async () => {
    const launched: string[] = [];
    const l = launcher({
      readyTasks: () => [makeCandidate('coder', { capabilities: ['coding'] })],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched).toEqual(['coder']);
    expect(outs[0]!.reservation?.ok).toBe(true);
  });

  test('launch throw → reservation released + outcome captured', async () => {
    const sched = new ResourceScheduler({ pool: [QWEN], slot: slot('active') });
    const l = launcher({
      scheduler: sched,
      readyTasks: () => [makeCandidate('boom', { capabilities: ['coding'] })],
      launch: () => {
        throw new Error('explode');
      },
    });
    const outs = await l.tick();
    expect(outs[0]!.ok).toBe(false);
    expect(outs[0]!.reason).toContain('launch-threw');
    expect(sched.inspect().modelInUse['qwen-coder-72b']).toBeUndefined();
  });
});

describe('Concurrency axis', () => {
  test('concurrencyOK=false skips the task', async () => {
    const launched: string[] = [];
    const l = launcher({
      concurrencyOK: () => false,
      readyTasks: () => [makeCandidate('t')],
      launch: (t) => {
        launched.push(t.id);
      },
    });
    const outs = await l.tick();
    expect(launched.length).toBe(0);
    expect(outs[0]!.reason).toBe('concurrency-cap');
  });
});

describe('D8.2 recordOutcome observer hook (FU8 PR #1)', () => {
  test('fires recordOutcome=launched for a successful dispatch', async () => {
    const records: { taskId: string; outcome: string; reason: string }[] = [];
    const l = launcher({
      readyTasks: () => [makeCandidate('t-ok')],
      launch: () => {},
      recordOutcome: (r) => { records.push({ taskId: r.taskId, outcome: r.outcome, reason: r.reason }); },
    });
    await l.tick();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ taskId: 't-ok', outcome: 'launched', reason: 'ok' });
  });

  test('fires recordOutcome=deferred for slot-mismatch (preferredSlot)', async () => {
    const records: { taskId: string; outcome: string }[] = [];
    const l = launcher({
      slot: slot('active'),
      readyTasks: () => [makeCandidate('t-slot', { preferredSlot: 'sleep' })],
      launch: () => {},
      recordOutcome: (r) => { records.push({ taskId: r.taskId, outcome: r.outcome }); },
    });
    await l.tick();
    expect(records).toHaveLength(1);
    expect(records[0]!.outcome).toBe('deferred');
  });

  test('fires recordOutcome=rejected for concurrency-cap', async () => {
    const records: { taskId: string; outcome: string; reason: string }[] = [];
    const l = launcher({
      concurrencyOK: () => false,
      readyTasks: () => [makeCandidate('t-conc')],
      launch: () => {},
      recordOutcome: (r) => { records.push({ taskId: r.taskId, outcome: r.outcome, reason: r.reason }); },
    });
    await l.tick();
    expect(records[0]).toMatchObject({ taskId: 't-conc', outcome: 'rejected', reason: 'concurrency-cap' });
  });

  test('fires recordOutcome=errored when launch throws', async () => {
    const records: { taskId: string; outcome: string; reason: string }[] = [];
    const l = launcher({
      readyTasks: () => [makeCandidate('t-boom')],
      launch: () => { throw new Error('oom'); },
      recordOutcome: (r) => { records.push({ taskId: r.taskId, outcome: r.outcome, reason: r.reason }); },
    });
    await l.tick();
    expect(records[0]!.outcome).toBe('errored');
    expect(records[0]!.reason).toContain('launch-threw:');
  });

  test('inSleepWindow snapshot propagates into axes', async () => {
    const records: { axes: { inSleepWindow: boolean } }[] = [];
    const l = launcher({
      readyTasks: () => [makeCandidate('t-axes')],
      launch: () => {},
      recordOutcome: (r) => { records.push({ axes: { inSleepWindow: r.axes.inSleepWindow } }); },
      inSleepWindow: () => true,
    });
    await l.tick();
    expect(records[0]!.axes.inSleepWindow).toBe(true);
  });

  test('recordOutcome throw is swallowed (best-effort)', async () => {
    const launched: string[] = [];
    const l = launcher({
      readyTasks: () => [makeCandidate('t-sink-throw')],
      launch: (t) => { launched.push(t.id); },
      recordOutcome: () => { throw new Error('observer-broke'); },
    });
    await expect(l.tick()).resolves.toBeDefined();
    expect(launched).toEqual(['t-sink-throw']);
  });
});

describe('Lifecycle', () => {
  test('start / stop manages the interval timer', () => {
    const l = launcher({
      readyTasks: () => [],
      launch: () => {},
    });
    l.start();
    l.start(); // idempotent
    l.stop();
    l.stop(); // idempotent
  });

  test('overlapping ticks are short-circuited', async () => {
    let inflight = 0;
    let peak = 0;
    const l = launcher({
      readyTasks: () => [makeCandidate('t')],
      launch: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight -= 1;
      },
    });
    await Promise.all([l.tick(), l.tick()]);
    expect(peak).toBeLessThanOrEqual(1);
  });
});
