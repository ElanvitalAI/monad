import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startChildLivenessHeartbeat } from '../core-turn/child-liveness-heartbeat.js';
import { debug } from '../debug/log.js';
import { runHeadlessGoalLoopPty } from './headless-elanous-driver.js';

function stalledSpawn() {
  return (() => ({
    id: 'self_stalled', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
    snapshot: () => 'working', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {}, canWrite: () => true,
  })) as never;
}

function stallClock(): () => number {
  const values = [2_000, 302_001, 302_002];
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

describe('headless activity grace observation', () => {
  test('run observation records the grace value and caller source on timeout extension', async () => {
    const extends_: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.timeout-extend') extends_.push(data ?? {});
    }) as never);
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 1, maxHardWaitSec: 2, pollMs: 1,
        activityGraceSec: 600, activityGraceSource: 'caller', nowMs: () => 0, ptyAvailable: () => true,
        spawn: (() => ({ id: 'activity_grace', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => 'working', drainDelta: () => 'output', isAlive: () => true, exitCode: null, kill: () => {}, canWrite: () => true })) as never,
      });
      expect(extends_).toContainEqual(expect.objectContaining({ graceI: 600, activityGraceSource: 'caller' }));
    } finally {
      log.mockRestore();
    }
  });
});

describe('headless screen-stall termination', () => {
  test('disabled knob preserves soft-timeout while recording the two-axis shadow verdict', async () => {
    const shadows: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'screen-stall-termination.shadow') shadows.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 2, pollMs: 1,
        activityGraceSec: 0, nowMs: stallClock(), spawn: stalledSpawn(), ptyAvailable: () => true,
        screenStallTermination: { enabled: false, minRung: 2 },
      });
      expect(result.exitReason).toBe('soft-timeout');
      expect(result.timedOut).toBe(true);
      expect(shadows).toContainEqual(expect.objectContaining({
        stallRung: 2, terminate: false, why: 'disabled', enabled: false,
        evidenceSatisfied: true, evidenceWhy: 'screen-stall-rung-2-and-output-silence-Infinity',
      }));
    } finally {
      log.mockRestore();
    }
  });

  test('records the frame-stall snapshot toolCalls and chars at the edge-triggered decision moment', async () => {
    const stalls: Record<string, unknown>[] = [];
    const snapshot = '\u001b[32m⏺ Read(foo.ts)\u001b[0m\n⏺ Edit(bar.ts)\nworking';
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'frame-stall') stalls.push(data ?? {});
    }) as never);
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 2, pollMs: 1,
        activityGraceSec: 0, nowMs: stallClock(), ptyAvailable: () => true,
        spawn: (() => ({
          id: 'self_stall_metrics', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => snapshot, drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {}, canWrite: () => true,
        })) as never,
      });

      expect(stalls).toContainEqual(expect.objectContaining({
        ptyId: 'self_stall_metrics', toolCalls: 2, chars: '⏺ Read(foo.ts)\n⏺ Edit(bar.ts)\nworking'.length,
      }));
    } finally {
      log.mockRestore();
    }
  });

  test('relays each frame-stall rung advance once and suppresses unchanged rung ticks', async () => {
    const progress: string[] = [];
    const clock = (() => {
      const values = [2_000, 17_001, 17_002, 62_001, 62_002];
      let i = 0;
      return () => values[Math.min(i++, values.length - 1)]!;
    })();
    await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 5, maxHardWaitSec: 5, pollMs: 1,
      activityGraceSec: 100, nowMs: clock, spawn: stalledSpawn(), ptyAvailable: () => true,
      // Frame-stall lines use the product's sparse parent-surface callback, not raw PTY progress.
      onSurfaceProgress: (line) => progress.push(line),
    });

    expect(progress.filter((line) => line.startsWith('[frame-stall]'))).toEqual([
      '[frame-stall] previousRung=unknown currentRung=0 toolCalls=0 chars=7\n',
      '[frame-stall] previousRung=0 currentRung=1 toolCalls=0 delta=0 chars=7 delta=0\n',
    ]);
  });

  test('no-progress is observed with its reason and stall rung without ending the poll loop', async () => {
    const suggestions: Record<string, unknown>[] = [];
    const verdicts: Record<string, unknown>[] = [];
    // ⚠️ 카테고리도 함께 기록한다(사후 리뷰 should-fix 2026-07-28) — FINDING 이 문서화한 조회 쿼리가
    //   `--category self-implement` 로 필터하므로, 이벤트명만 단언하면 **카테고리가 바뀌어도 통과**하고
    //   그러면 문서의 쿼리가 조용히 0건을 낸다.
    // ⚠️ category 와 data 를 **같은 레코드**로 묶어 둔다(사후 리뷰 should-fix) — 따로 모으면
    //   서로 다른 이벤트로도 두 단언이 동시에 만족될 수 있다.
    const records: { category: string; event: string; data: Record<string, unknown> }[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      records.push({ category, event, data: data ?? {} });
      if (event === 'brain.suggestion') suggestions.push(data ?? {});
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 2, pollMs: 1,
        activityGraceSec: 0, nowMs: stallClock(), spawn: stalledSpawn(), ptyAvailable: () => true,
        autoStop: { enabled: true, minRung: 2 },
        brain: { decide: () => ({ action: 'no-progress', reason: '화면은 멈췄고 완료 표시는 없다' }) },
      });
      expect(result.exitReason).toBe('soft-timeout');
      expect(result.timedOut).toBe(true);
      const expected = expect.objectContaining({
        action: 'no-progress', reason: '화면은 멈췄고 완료 표시는 없다', stallRung: 2,
        applied: false, why: 'action-no-progress', novelCompletionSignal: false,
      });
      expect(suggestions).toContainEqual(expected);
      // ⭐ 문서화된 조회 쿼리(`--category self-implement --event brain.suggestion`)가 계속 닿는지 고정 —
      //   category·event·data 를 **한 레코드에서** 함께 단언한다.
      expect(records).toContainEqual({ category: 'self-implement', event: 'brain.suggestion', data: expected });
      expect(verdicts).toContainEqual(expected);
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    ['owned', (): boolean => true, 'input', 'action-input', 'child-cannot-receive-input:pty,supervisorQueue'],
    ['lost', (): boolean => false, 'wait', 'action-wait', 'action-wait'],
    ['unknown', (): boolean => { throw new Error('probe failed'); }, 'wait', 'action-wait', 'action-wait'],
  ] as const)('disabled supervision preserves %s ownership when input is unavailable', async (ownership, canWrite, action, evidenceWhy, autoAssistEvidenceWhy) => {
    const outcomes: Record<string, unknown>[] = [];
    const suggestions: Record<string, unknown>[] = [];
    const verdicts: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'brain.input-outcome') outcomes.push(data ?? {});
      if (event === 'brain.suggestion') suggestions.push(data ?? {});
      if (event === 'run-supervision.verdict') verdicts.push(data ?? {});
    }) as never);
    try {
      await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 2, pollMs: 1,
        activityGraceSec: 0, nowMs: stallClock(), ptyAvailable: () => true,
        spawn: (() => ({
          id: `assist_${ownership}`, write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => 'working', drainDelta: () => '', isAlive: () => true, exitCode: null, kill: () => {}, canWrite,
        })) as never,
        autoAssist: { enabled: false, minRung: 2 },
        brain: { decide: () => ({ action: 'input', text: 'continue' }) },
      });
      const expectedVerdict = expect.objectContaining({
        action, actionDetail: action === 'input' ? 'continue' : '', applied: false, why: 'disabled',
        shadowed: true, wouldStop: false, evidenceWhy,
        autoAssistShadowed: true, autoAssistWouldAssist: false,
        autoAssistEvidenceWhy, autoAssistOwnership: ownership,
      });
      expect(suggestions).toContainEqual(expectedVerdict);
      expect(verdicts).toContainEqual(expectedVerdict);
      expect(outcomes).toContainEqual(expect.objectContaining({
        axis: 'assist', action, applied: false, why: 'disabled', shadowed: true,
        wouldAssist: false, evidenceWhy: autoAssistEvidenceWhy, canReceiveInput: false,
      }));
    } finally {
      log.mockRestore();
    }
  });

  test('enabled knob ends before the soft budget when both screen-stall and output-silence axes hold', async () => {
    const result = await runHeadlessGoalLoopPty({
      binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 100, pollMs: 1,
      activityGraceSec: 0, nowMs: stallClock(), spawn: stalledSpawn(), ptyAvailable: () => true,
      screenStallTermination: { enabled: true, minRung: 2 },
    });
    expect(result.exitReason).toBe('screen-stall-silence');
    expect(result.timedOut).toBe(false);
  });

  test('a production liveness heartbeat cannot reset output-only screen silence', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'screen-stall-liveness-'));
    let now = 0;
    const stopHeartbeat = startChildLivenessHeartbeat({ path: join(cwd, '.elanous-child-liveness.hb'), intervalMs: 1, nowMs: () => ++now });
    const shadows: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'screen-stall-termination.shadow') shadows.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd, featurePrompt: 'x', maxWaitSec: 100, pollMs: 2,
        activityGraceSec: 0, nowMs: stallClock(), spawn: stalledSpawn(), ptyAvailable: () => true,
        screenStallTermination: { enabled: true, minRung: 2 },
      });
      expect(result).toMatchObject({ exitReason: 'screen-stall-silence', timedOut: false });
      expect(shadows).toContainEqual(expect.objectContaining({
        outputOnlySilentFor: Number.POSITIVE_INFINITY, heartbeatInclusiveSilentFor: 0,
        silentFor: Number.POSITIVE_INFINITY, terminate: true,
      }));
    } finally {
      stopHeartbeat();
      log.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('counts finite output silence from the final delta even when heartbeat refreshes then stops', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'screen-stall-finite-output-'));
    const heartbeatPath = join(cwd, '.elanous-child-liveness.hb');
    const shadows: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'screen-stall-termination.shadow') shadows.push(data ?? {});
    }) as never);
    let deltas = 0;
    let progressPolls = 0;
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd, featurePrompt: 'x', maxWaitSec: 100, pollMs: 1,
        activityGraceSec: 4, nowMs: stallClock(), ptyAvailable: () => true,
        spawn: (() => ({
          id: 'self_finite_output', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => 'working', drainDelta: () => ++deltas === 1 ? 'first output' : '', isAlive: () => true,
          exitCode: null, kill: () => {}, canWrite: () => true,
        })) as never,
        screenStallTermination: { enabled: true, minRung: 2 },
        onProgress: () => {
          progressPolls += 1;
          if (progressPolls === 2 || progressPolls === 3) writeFileSync(heartbeatPath, JSON.stringify({ at: progressPolls }), 'utf8');
        },
      });
      expect(result).toMatchObject({ exitReason: 'screen-stall-silence', timedOut: false });
      expect(shadows).toContainEqual(expect.objectContaining({
        outputOnlySilentFor: 4, heartbeatInclusiveSilentFor: 1, silentFor: 4, terminate: true,
      }));
    } finally {
      log.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('continuously changing output remains protected even while a heartbeat is present', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'screen-stall-output-'));
    let now = 0;
    const stopHeartbeat = startChildLivenessHeartbeat({ path: join(cwd, '.elanous-child-liveness.hb'), intervalMs: 1, nowMs: () => ++now });
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd, featurePrompt: 'x', maxWaitSec: 2, maxHardWaitSec: 2, pollMs: 2,
        activityGraceSec: 100, nowMs: stallClock(), ptyAvailable: () => true,
        spawn: (() => ({
          id: 'self_heartbeat_output', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => 'working', drainDelta: () => 'still emitting', isAlive: () => true, exitCode: null, kill: () => {},
        })) as never,
        screenStallTermination: { enabled: true, minRung: 2 },
      });
      expect(result.exitReason).toBe('loop-exhausted');
    } finally {
      stopHeartbeat();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a high screen-stall rung with recent PTY output records loop exhaustion without changing the public result', async () => {
    const done: Record<string, unknown>[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.done') done.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', maxWaitSec: 2, maxHardWaitSec: 2, pollMs: 1,
        activityGraceSec: 100, nowMs: stallClock(), ptyAvailable: () => true,
        spawn: (() => ({
          id: 'self_output_active', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => 'working', drainDelta: () => 'still emitting', isAlive: () => true, exitCode: null, kill: () => {},
        })) as never,
        screenStallTermination: { enabled: true, minRung: 2 },
      });
      expect(result).toMatchObject({ exitReason: 'loop-exhausted', timedOut: true, reachedCompletion: false });
      expect(done).toContainEqual(expect.objectContaining({ exitReason: 'loop-exhausted-without-completion', timedOut: true, reachedCompletion: false }));
    } finally {
      log.mockRestore();
    }
  });

  test('preserves max-wait exhaustion when only the final snapshot declares completion', async () => {
    const done: Record<string, unknown>[] = [];
    let snapshots = 0;
    const log = spyOn(debug, 'log').mockImplementation(((_category: string, event: string, data?: Record<string, unknown>) => {
      if (event === 'headless.done') done.push(data ?? {});
    }) as never);
    try {
      const result = await runHeadlessGoalLoopPty({
        binRoot: '/tmp/repo', cwd: '/tmp/worktree', featurePrompt: 'x', runId: 'run-final-marker',
        maxWaitSec: 1, maxHardWaitSec: 1, pollMs: 1, activityGraceSec: 100,
        ptyAvailable: () => true,
        spawn: (() => ({
          id: 'self_final_marker', write: () => {}, renderScreen: async () => 'working', renderScreenPng: async () => null,
          snapshot: () => ++snapshots === 1 ? 'working' : 'GOAL-COMPLETE',
          drainDelta: () => 'still emitting', isAlive: () => true, exitCode: null, kill: () => {},
        })) as never,
      });

      expect(result.reachedCompletion).toBe(true);
      expect(result.exitReason).toBe('loop-exhausted');
      expect(done).toContainEqual(expect.objectContaining({
        runId: 'run-final-marker', reachedCompletion: true, exitReason: 'completion-after-loop-exhaustion',
      }));
    } finally {
      log.mockRestore();
    }
  });
});
