import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareLifecycleToScreen, scopeLifecycleToScreen } from './lifecycle-screen-scoreboard.js';
import { runHeadlessGoalLoopPty } from './headless-elanous-driver.js';
import { debug } from '../debug/log.js';
import { ChannelBus } from '../terminal-matrix/channel-bus.js';
import { publishLifecycleRecord, snapshotRunLifecycle } from '../signal/lifecycle-record.js';
import { attachLifecycleBridge, readRunLifecycle, resetLifecycleBridgeForTesting } from '../signal/lifecycle-bridge.js';
import { resetLifecycleSequencesForTesting } from '../signal/lifecycle-sequence.js';
import { setPtyManifestDbPathForTesting } from '../pty-shell/pty-manifest.js';
import { addSelfDevRunParticipant, loadSelfDevRun, saveSelfDevRun, selfDevRunsDir } from '../self-dev/run-store.js';
import type { LifecycleRecord } from '../signal/lifecycle-record.js';

const screen = { exitReason: 'child-exit' as const, timedOut: false, reachedCompletion: true };
const scope = { runId: 'run-a', subjectPtyId: 'child-a' };

function lifecycleRecord(overrides: Partial<LifecycleRecord> = {}): LifecycleRecord {
  return {
    runId: 'run-a', ptyId: 'publisher-a', subjectPtyId: 'child-a', depth: 1, role: 'child', seq: 1, at: 1,
    class: 'progress', name: 'complete', payload: { summary: 'done', changedFiles: [] }, truncated: false,
    ...overrides,
  } as LifecycleRecord;
}

const complete = lifecycleRecord();
const failed = lifecycleRecord({ name: 'failed', payload: { reason: 'blocked' } });
const started = lifecycleRecord({ name: 'started', payload: { step: 'start' } });
const progress = lifecycleRecord({ name: 'progress', payload: { step: 'write' } });
const entry = (record: LifecycleRecord, id = 1) => ({ id, record });

describe('lifecycle screen scoreboard', () => {
  test('classifies both channels agreeing', () => {
    expect(compareLifecycleToScreen(screen, [entry(complete)], scope).classification).toBe('agree');
  });

  test('classifies both channels disagreeing', () => {
    expect(compareLifecycleToScreen(screen, [entry(failed)], scope).classification).toBe('disagree');
  });

  test('classifies screen-only when no signal is published', () => {
    expect(compareLifecycleToScreen(screen, [], scope).classification).toBe('screen-only');
  });

  test('keeps the old signal-incomplete class for screen completion with no terminal signal', () => {
    expect(compareLifecycleToScreen(screen, [entry(started)], scope).classification).toBe('signal-incomplete');
    expect(compareLifecycleToScreen(screen, [entry(started), entry(progress, 2)], scope).classification).toBe('signal-incomplete');
  });

  test('distinguishes a missing terminal signal from one a known-live child has not published yet', () => {
    expect(compareLifecycleToScreen(screen, [entry(started)], { ...scope, childExited: true }).classification)
      .toBe('signal-incomplete');
    expect(compareLifecycleToScreen(screen, [entry(started)], { ...scope, childExited: false }).classification)
      .toBe('signal-not-yet');
    expect(compareLifecycleToScreen(screen, [entry(started), entry(progress, 2)], { ...scope, childExited: undefined }).classification)
      .toBe('signal-incomplete');
  });

  test('reclassifies the old incomplete membership when the screen concludes non-completion and signal is silent', () => {
    const nonCompletion = { exitReason: 'completion-marker' as const, timedOut: false, reachedCompletion: false };

    expect(compareLifecycleToScreen(nonCompletion, [entry(started)], scope).classification)
      .toBe('signal-silent-after-screen-noncompletion');
    expect(compareLifecycleToScreen(nonCompletion, [entry(started), entry(progress, 2)], scope).classification)
      .toBe('signal-silent-after-screen-noncompletion');
  });

  test('changes only the old incomplete classification membership across equivalent non-terminal scoreboard observations and executions', async () => {
    const records = [entry(started), entry(progress, 2)];
    const observations: Record<string, unknown>[] = [];
    const executionIds: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.lifecycle-screen-scoreboard') observations.push(data ?? {});
    }) as never);
    const run = async (snapshot: string, alive: boolean, exitCode: number | null) => {
      let executionId = '';
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
        stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
        readLifecycle: () => records.map(({ id, record }) => ({ id, record: { ...record, subjectPtyId: executionId } })),
        spawn: ((options: { id: string }) => {
          executionId = options.id;
          executionIds.push(executionId);
          return {
            id: 'child-a', write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => snapshot, drainDelta: () => '', isAlive: () => alive, exitCode, kill: () => {},
          };
        }) as never,
      });
      return { result, observation: observations.at(-1)! };
    };

    try {
      const completed = await run('GOAL-COMPLETE', true, null);
      const nonCompleted = await run('working', false, 1);

      expect(completed).toEqual({
        result: { ok: true, reachedCompletion: true, transcript: 'GOAL-COMPLETE', toolCalls: 0, timedOut: false, exitReason: 'completion-marker', exitCode: null, ptyId: 'child-a' },
        observation: {
          runId: 'run-a',
          classification: 'agree',
          screen: { exitReason: 'completion-marker', timedOut: false, reachedCompletion: true },
          signal: { recordCount: 3, observedNames: ['started', 'progress', 'complete'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'complete', subjectPtyId: executionIds[0], unit: 'round', scopeStatus: 'scoped' },
          lifecycleRead: { source: 'publisher-reported', emptyReason: null },
        },
      });
      expect(nonCompleted).toEqual({
        result: { ok: true, reachedCompletion: false, transcript: 'working', toolCalls: 0, timedOut: false, exitReason: 'child-exit', exitCode: 1, ptyId: 'child-a' },
        observation: {
          runId: 'run-a',
          classification: 'agree',
          screen: { exitReason: 'child-exit', timedOut: false, reachedCompletion: false },
          signal: { recordCount: 3, observedNames: ['started', 'progress', 'failed'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'failed', subjectPtyId: executionIds[1], unit: 'round', scopeStatus: 'scoped' },
          lifecycleRead: { source: 'publisher-reported', emptyReason: null },
        },
      });
    } finally {
      log.mockRestore();
    }
  });

  test('uses the existing screen-conclusion outcome for every exit reason in the incomplete split', () => {
    const expected = {
      abort: 'signal-silent-after-screen-noncompletion',
      'brain-stop': 'signal-incomplete',
      'child-exit': 'signal-incomplete',
      'completion-marker': 'signal-incomplete',
      'soft-timeout': 'signal-silent-after-screen-noncompletion',
      'wallclock-cap': 'signal-silent-after-screen-noncompletion',
      'loop-exhausted': 'signal-silent-after-screen-noncompletion',
      'not-started': 'signal-silent-after-screen-noncompletion',
    } as const;

    for (const [exitReason, classification] of Object.entries(expected)) {
      expect(compareLifecycleToScreen(
        { exitReason: exitReason as keyof typeof expected, timedOut: false, reachedCompletion: true },
        [entry(started)],
        scope,
      ).classification).toBe(classification);
    }
  });

  test('keeps terminal signal outcomes byte-identical regardless of screen outcome', () => {
    const nonCompletion = { exitReason: 'soft-timeout' as const, timedOut: true, reachedCompletion: false };

    expect(compareLifecycleToScreen(screen, [entry(complete)], scope)).toEqual({
      classification: 'agree',
      screen,
      signal: { recordCount: 1, observedNames: ['complete'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'complete', subjectPtyId: 'child-a', unit: 'round', scopeStatus: 'scoped' },
    });
    expect(compareLifecycleToScreen(screen, [entry(failed)], scope)).toEqual({
      classification: 'disagree',
      screen,
      signal: { recordCount: 1, observedNames: ['failed'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'failed', subjectPtyId: 'child-a', unit: 'round', scopeStatus: 'scoped' },
    });
    expect(compareLifecycleToScreen(nonCompletion, [entry(complete)], scope)).toEqual({
      classification: 'signal-only',
      screen: nonCompletion,
      signal: { recordCount: 1, observedNames: ['complete'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'complete', subjectPtyId: 'child-a', unit: 'round', scopeStatus: 'scoped' },
    });
    expect(compareLifecycleToScreen(nonCompletion, [entry(failed)], scope)).toEqual({
      classification: 'signal-only',
      screen: nonCompletion,
      signal: { recordCount: 1, observedNames: ['failed'], excluded: { byRunId: 0, bySubjectPtyId: 0 }, ended: true, outcome: 'failed', subjectPtyId: 'child-a', unit: 'round', scopeStatus: 'scoped' },
    });
  });

  test('classifies signal-only when the screen did not conclude', () => {
    expect(compareLifecycleToScreen(
      { exitReason: 'soft-timeout', timedOut: true, reachedCompletion: false },
      [entry(failed)],
      scope,
    ).classification).toBe('signal-only');
  });

  test('classifies terminal signals as signal-only after a non-timeout loop exhaustion', () => {
    const exhausted = { exitReason: 'loop-exhausted' as const, timedOut: false, reachedCompletion: false };
    expect(compareLifecycleToScreen(exhausted, [entry(complete)], scope).classification).toBe('signal-only');
    expect(compareLifecycleToScreen(exhausted, [entry(failed)], scope).classification).toBe('signal-only');
  });

  test('excludes another child of the same run', () => {
    const records = [
      entry(lifecycleRecord({ subjectPtyId: 'child-a', name: 'failed', payload: { reason: 'early round failed' } })),
      entry(lifecycleRecord({ subjectPtyId: 'child-b' }), 2),
    ];
    const scoped = scopeLifecycleToScreen(records, { runId: 'run-a', subjectPtyId: 'child-b' });

    expect(scoped.records).toEqual([records[1]]);
    expect(compareLifecycleToScreen(screen, records, { runId: 'run-a', subjectPtyId: 'child-b' }))
      .toMatchObject({ classification: 'agree', signal: { recordCount: 1 } });
  });

  test('excludes the same subject identity from another run', () => {
    const records = [
      entry(lifecycleRecord({ runId: 'run-other', subjectPtyId: 'child-b', name: 'failed', payload: { reason: 'foreign run' } })),
      entry(lifecycleRecord({ runId: 'run-a', subjectPtyId: 'child-b' }), 2),
    ];

    expect(scopeLifecycleToScreen(records, { runId: 'run-a', subjectPtyId: 'child-b' }).records)
      .toEqual([records[1]]);
  });

  test('reports scoped names and exclusion reasons without changing the comparison', () => {
    const records = [
      ...Array.from({ length: 21 }, (_, index) => entry(lifecycleRecord({ name: 'started', payload: { index } }), index + 1)),
      entry(lifecycleRecord({ runId: 'run-other', name: 'failed', payload: { reason: 'other run' } }), 22),
      entry(lifecycleRecord({ subjectPtyId: 'child-other', name: 'failed', payload: { reason: 'other child' } }), 23),
    ];

    const signal = compareLifecycleToScreen(screen, records, scope).signal;
    expect(signal).toMatchObject({
      recordCount: 21,
      observedNames: Array.from({ length: 20 }, () => 'started'),
      excluded: { byRunId: 1, bySubjectPtyId: 1 },
      ended: false,
      outcome: null,
      subjectPtyId: 'child-a',
      unit: 'round',
      scopeStatus: 'scoped',
    });
  });

  test('reports empty observation and exclusions when scoping is unavailable', () => {
    for (const scoped of [
      { runId: 'run-a', subjectPtyId: '' },
      { runId: 'run-a', subjectPtyId: 'child-a', availability: 'unavailable' as const },
    ]) {
      expect(compareLifecycleToScreen(screen, [entry(started)], scoped).signal)
        .toMatchObject({ observedNames: [], excluded: { byRunId: 0, bySubjectPtyId: 0 } });
    }
  });

  // ⛔ 나머지 두 특수 경로도 «값»으로 고정한다 — scope 를 아예 안 준 경우와, 스코프는 섰는데
  //    통과한 레코드가 0인 경우. 이 둘이 안 고정되면 「빈 관측」이 경로마다 달라질 수 있다.
  test('reports empty observation and zero exclusions when no scope is supplied', () => {
    expect(compareLifecycleToScreen(screen, [entry(started)]).signal)
      .toMatchObject({
        recordCount: 0, observedNames: [], excluded: { byRunId: 0, bySubjectPtyId: 0 }, scopeStatus: 'missing-subject',
      });
  });

  test('counts exclusions while reporting an empty observation when scoping keeps no record', () => {
    expect(compareLifecycleToScreen(screen, [entry(lifecycleRecord({ runId: 'run-other' }))], scope).signal)
      .toMatchObject({
        recordCount: 0, observedNames: [], excluded: { byRunId: 1, bySubjectPtyId: 0 }, scopeStatus: 'no-records',
      });
  });

  // ⭐ 귀속 «우선순위»를 값으로 고정한다 — runId 와 subjectPtyId 가 «둘 다» 어긋난 레코드는
  //    byRunId 에만 실린다(bySubjectPtyId 는 runId 가 맞는 것 중에서만 센다).
  //    ⛔ 그래서 bySubjectPtyId 는 「이 런 안에서 남의 자식」의 수이지 「subjectPtyId 불일치 전체」가 아니다.
  test('attributes a record that mismatches both keys to byRunId only', () => {
    const bothMismatch = entry(lifecycleRecord({ runId: 'run-other', subjectPtyId: 'child-other' }));
    expect(compareLifecycleToScreen(screen, [bothMismatch], scope).signal.excluded)
      .toEqual({ byRunId: 1, bySubjectPtyId: 0 });
  });

  test('each later round sees only its own child record under one run', () => {
    const records = [
      entry(lifecycleRecord({ subjectPtyId: 'child-round-0', name: 'started', payload: { round: 0 } })),
      entry(lifecycleRecord({ subjectPtyId: 'child-round-1', name: 'started', payload: { round: 1 } }), 2),
      entry(lifecycleRecord({ subjectPtyId: 'child-round-2', name: 'started', payload: { round: 2 } }), 3),
    ];

    for (const subjectPtyId of ['child-round-0', 'child-round-1', 'child-round-2']) {
      expect(compareLifecycleToScreen(screen, records, { runId: 'run-a', subjectPtyId }))
        .toMatchObject({ signal: { recordCount: 1, subjectPtyId, unit: 'round', scopeStatus: 'scoped' } });
    }
  });

  test('matches by subject rather than publisher', () => {
    const publishedByParent = lifecycleRecord({ ptyId: 'parent-publisher', subjectPtyId: 'child-screen' });

    expect(scopeLifecycleToScreen([entry(publishedByParent)], { runId: 'run-a', subjectPtyId: 'child-screen' }).records)
      .toEqual([entry(publishedByParent)]);
    expect(scopeLifecycleToScreen([entry(publishedByParent)], { runId: 'run-a', subjectPtyId: 'parent-publisher' }).records)
      .toEqual([]);
  });

  test('does not classify unscoped records as a round comparison', () => {
    expect(compareLifecycleToScreen(screen, [entry(complete)]))
      .toMatchObject({ classification: 'screen-only', signal: { recordCount: 0, subjectPtyId: null, unit: 'round', scopeStatus: 'missing-subject' } });
  });

  test('records missing subject, no records, and unavailable reader as distinct signal states', () => {
    expect(compareLifecycleToScreen(screen, [entry(complete)], { runId: 'run-a', subjectPtyId: undefined }))
      .toMatchObject({ classification: 'screen-only', signal: { recordCount: 0, subjectPtyId: null, scopeStatus: 'missing-subject' } });
    expect(compareLifecycleToScreen(screen, [], { runId: 'run-a', subjectPtyId: 'child-a' }))
      .toMatchObject({ classification: 'screen-only', signal: { recordCount: 0, subjectPtyId: 'child-a', scopeStatus: 'no-records' } });
    expect(compareLifecycleToScreen(screen, [entry(complete)], {
      runId: 'run-a', subjectPtyId: 'child-a', availability: 'unavailable',
    })).toMatchObject({ classification: 'screen-only', signal: { recordCount: 0, subjectPtyId: 'child-a', scopeStatus: 'unavailable' } });
  });

  test('keeps the screen verdict unchanged while adding round scope metadata', () => {
    const verdict = { exitReason: 'completion-marker' as const, timedOut: false, reachedCompletion: true };
    const scoreboard = compareLifecycleToScreen(verdict, [entry(complete)], { runId: 'run-a', subjectPtyId: 'child-a' });

    expect(scoreboard.screen).toEqual(verdict);
    expect(scoreboard.signal).toMatchObject({ subjectPtyId: 'child-a', unit: 'round' });
  });

  test('keeps PTY execution result and termination unchanged when lifecycle observation is populated', async () => {
    let kills = 0;
    const result = await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
      ptyAvailable: () => true,
      readPublisherStateDir: () => process.cwd(),
      readLifecycle: () => [entry(lifecycleRecord({ subjectPtyId: 'different-child' }))],
      spawn: (() => ({
        id: 'child-screen', write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
        snapshot: () => '', drainDelta: () => '', isAlive: () => false, exitCode: 0, kill: () => { kills += 1; },
      })) as never,
    });

    expect(result).toMatchObject({ ok: true, reachedCompletion: true, timedOut: false, exitReason: 'child-exit', exitCode: 0, ptyId: 'child-screen' });
    expect(kills).toBe(1);
  });

  test('closes the child participant as parent when marker polling ends', async () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-parent-participant-'));
    const runId = 'run-parent-closes-participant';
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId, maxWaitSec: 1, pollMs: 1,
        stateDir: root, ptyAvailable: () => true,
        spawn: ((options: { id: string }) => {
          saveSelfDevRun({ runId, createdAt: 1, updatedAt: 1, results: [] }, selfDevRunsDir(root));
          addSelfDevRunParticipant(runId, {
            id: options.id, kind: 'pty', transports: [{ kind: 'pty', id: options.id }], registeredAt: 1, runIdSource: 'explicit',
          }, selfDevRunsDir(root));
          return { id: options.id, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
        }) as never,
      });

      expect(result.exitReason).toBe('completion-marker');
      expect(loadSelfDevRun(runId, selfDevRunsDir(root))?.participants).toEqual([
        expect.objectContaining({ id: result.ptyId, closedBy: 'parent', closedAt: expect.any(Number) }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('publishes one parent-proxy terminal declaration when marker polling ends without a child terminal', async () => {
    const bus = new ChannelBus();
    let executionId = '';
    const result = await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
      lifecycleBus: bus, stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
      readLifecycle: () => [entry(lifecycleRecord({ name: 'started', payload: { step: 'start' }, ptyId: executionId, subjectPtyId: executionId }))],
      spawn: ((options: { id: string }) => {
        executionId = options.id;
        return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
          snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
      }) as never,
    });

    expect(result).toMatchObject({ reachedCompletion: true, exitReason: 'completion-marker' });
    expect(snapshotRunLifecycle(bus, 'run-a')).toEqual([expect.objectContaining({
      name: 'complete', role: 'child', ptyId: executionId, subjectPtyId: executionId,
      payload: expect.objectContaining({ verification: 'parent-proxy' }),
    })]);
  });

  test('persists one collision-free parent-proxy terminal through the lifecycle bridge', async () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-parent-terminal-'));
    resetLifecycleBridgeForTesting();
    setPtyManifestDbPathForTesting(join(root, 'manifest.db'));
    const bus = new ChannelBus();
    const detach = attachLifecycleBridge(bus, 'run-a');
    resetLifecycleSequencesForTesting();
    let executionId = '';
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
        lifecycleBus: bus, stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
        readLifecycle: () => readRunLifecycle('run-a'),
        spawn: ((options: { id: string }) => {
          executionId = options.id;
          publishLifecycleRecord(bus, lifecycleRecord({
            name: 'started', payload: { step: 'start' }, ptyId: executionId, subjectPtyId: executionId, seq: 1,
          }));
          publishLifecycleRecord(bus, lifecycleRecord({
            class: 'condition', name: 'ownership-lent', transition: 'enter', resumable: true,
            payload: { actor: 'parent', mode: 'control' }, ptyId: executionId, subjectPtyId: 'other-subject', seq: 2,
          }));
          return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
        }) as never,
      });

      const producerRecords = readRunLifecycle('run-a')
        .filter(({ record }) => record.ptyId === executionId)
        .map(({ record }) => record);
      expect(producerRecords).toEqual([
        expect.objectContaining({ name: 'started', seq: 1, ptyId: executionId, subjectPtyId: executionId }),
        expect.objectContaining({ name: 'ownership-lent', seq: 2, ptyId: executionId, subjectPtyId: 'other-subject' }),
        expect.objectContaining({
          name: 'complete', seq: 3, role: 'child', ptyId: executionId, subjectPtyId: executionId,
          payload: expect.objectContaining({ verification: 'parent-proxy' }),
        }),
      ]);
    } finally {
      detach();
      resetLifecycleBridgeForTesting();
      setPtyManifestDbPathForTesting(null);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('distinguishes parent terminal publication from suppression when child terminal state differs', async () => {
    const observations: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      observations.push({ category, event, data: data ?? {} });
    }) as never);
    const run = async (childAlreadyTerminal: boolean) => {
      const bus = new ChannelBus();
      let executionId = '';
      await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
        lifecycleBus: bus, stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
        readLifecycle: () => childAlreadyTerminal
          ? [entry(lifecycleRecord({ ptyId: executionId, subjectPtyId: executionId, seq: 7 }))]
          : [entry(lifecycleRecord({ name: 'started', payload: { step: 'start' }, ptyId: executionId, subjectPtyId: executionId, seq: 4 }))],
        spawn: ((options: { id: string }) => {
          executionId = options.id;
          return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
        }) as never,
      });
      return { executionId, lifecycle: snapshotRunLifecycle(bus, 'run-a') };
    };

    try {
      const childTerminal = await run(true);
      const parentProxy = await run(false);

      expect(childTerminal.lifecycle).toEqual([]);
      expect(parentProxy.lifecycle).toEqual([expect.objectContaining({
        name: 'complete', payload: expect.objectContaining({ verification: 'parent-proxy' }),
      })]);
      expect(observations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          category: 'self-implement', event: 'headless.parent-terminal-suppressed', data: {
            runId: 'run-a', ptyId: childTerminal.executionId, reason: 'child-already-declared-terminal', terminalCount: 1, maxSequence: 7,
          },
        }),
        expect.objectContaining({
          category: 'self-implement', event: 'headless.parent-terminal-published', data: {
            runId: 'run-a', ptyId: parentProxy.executionId, reason: 'child-terminal-absent', terminalCount: 0, maxSequence: 4,
          },
        }),
      ]));
    } finally {
      log.mockRestore();
    }
  });

  test('publishes a child-owned parent proxy when another PTY terminal merely names the child as subject', async () => {
    const bus = new ChannelBus();
    let executionId = '';
    await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
      lifecycleBus: bus, stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
      readLifecycle: () => [entry(lifecycleRecord({ ptyId: 'other-publisher', subjectPtyId: executionId }))],
      spawn: ((options: { id: string }) => {
        executionId = options.id;
        return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
          snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
      }) as never,
    });

    expect(snapshotRunLifecycle(bus, 'run-a')).toEqual([expect.objectContaining({
      name: 'complete', role: 'child', ptyId: executionId, subjectPtyId: executionId,
      payload: expect.objectContaining({ verification: 'parent-proxy' }),
    })]);
  });

  test('publishes failed parent-proxy terminals for timeout and abort without breaking result return', async () => {
    const run = async (signal?: AbortSignal) => {
      const bus = new ChannelBus();
      let executionId = '';
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 0, pollMs: 1,
        lifecycleBus: bus, signal, stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
        readLifecycle: () => [],
        spawn: ((options: { id: string }) => {
          executionId = options.id;
          return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => 'working', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
        }) as never,
      });
      return { result, record: snapshotRunLifecycle(bus, 'run-a')[0], executionId };
    };
    const timeout = await run();
    const controller = new AbortController();
    controller.abort();
    const aborted = await run(controller.signal);

    expect(timeout).toMatchObject({ result: { exitReason: 'soft-timeout', reachedCompletion: false }, record: {
      name: 'failed', role: 'child', ptyId: timeout.executionId, subjectPtyId: timeout.executionId,
      payload: { reason: 'parent-declared terminal after child polling ended: soft-timeout' },
    } });
    expect(aborted).toMatchObject({ result: { exitReason: 'abort', reachedCompletion: false }, record: {
      name: 'failed', role: 'child', payload: { reason: 'parent-declared terminal after child polling ended: abort' },
    } });
  });

  test('returns the polling result when parent-proxy publishing throws', async () => {
    let executionId = '';
    const result = await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
      lifecycleBus: { publish: () => { throw new Error('publish unavailable'); } } as unknown as ChannelBus,
      stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(), readLifecycle: () => [],
      spawn: ((options: { id: string }) => {
        executionId = options.id;
        return { id: executionId, write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
          snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {} };
      }) as never,
    });

    expect(result).toMatchObject({ ok: true, reachedCompletion: true, exitReason: 'completion-marker', ptyId: executionId });
  });

  test('forwards each scoreboard classification without recomputing it', async () => {
    const classifications: string[] = [];
    const run = (records: readonly { id: number; record: LifecycleRecord }[]) => {
      let executionId = '';
      return runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-a', maxWaitSec: 1, pollMs: 1,
        stateDir: process.cwd(), ptyAvailable: () => true, readPublisherStateDir: () => process.cwd(),
        readLifecycle: () => records.map(({ id, record }) => ({ id, record: { ...record, subjectPtyId: executionId } })),
        onLifecycleScreenClassification: (classification) => { classifications.push(classification); },
        spawn: ((options: { id: string }) => {
          executionId = options.id;
          return {
            id: 'child-a', write: () => {}, renderScreen: async () => '', renderScreenPng: async () => null,
            snapshot: () => 'GOAL-COMPLETE', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {},
          };
        }) as never,
      });
    };

    await run([entry(complete)]);
    await run([entry(started)]);

    expect(classifications).toEqual(['agree', 'agree']);
  });
});
