// W9b Z7 · auto-relay TaskLifecycleListener — observe → policy → 3-lane spawn.

import { describe, expect, test } from 'bun:test';
import {
  createInMemoryNudgeHistoryStore,
  observeIdleTask,
  NUDGE_LANE_PERSONAS,
  type AutoRelayListenerDeps,
} from '../../../src/showroom/auto-relay/task-listener';
import { DEFAULT_QUIET_HOURS } from '../../../src/showroom/auto-relay/nudge-policy';
import type { ShowroomLaneCallable } from '../../../src/task-orchestrator/surfaces/showroom-surface';

const HOUR = 60 * 60 * 1000;

function buildDeps(opts?: {
  callable?: ShowroomLaneCallable;
  emit?: AutoRelayListenerDeps['onNudgeRecord'];
}): AutoRelayListenerDeps & {
  calls: Array<{ role: string; model: string; prompt: string }>;
  history: ReturnType<typeof createInMemoryNudgeHistoryStore>;
} {
  const calls: Array<{ role: string; model: string; prompt: string }> = [];
  const callable: ShowroomLaneCallable = opts?.callable ?? (async (input) => {
    calls.push({ role: input.role, model: input.model, prompt: input.prompt });
    return { text: `${input.role}-out`, modelId: input.model };
  });
  const history = createInMemoryNudgeHistoryStore();
  return {
    calls,
    history,
    laneCallable: callable,
    policy: {
      // Open the quiet window so the test does not depend on wall clock.
      quietHours: { ...DEFAULT_QUIET_HOURS, startHour: 0, endHour: 23 },
    },
    mintSessionId: (taskId) => `showroom:nudge-${taskId}`,
    now: () => 1_000_000,
    ...(opts?.emit ? { onNudgeRecord: opts.emit } : {}),
  };
}

describe('observeIdleTask · gating', () => {
  test('still-fresh observation yields skip + no spawn', async () => {
    const deps = buildDeps();
    const result = await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 1 * HOUR,
      },
      { taskTitle: 'pending review' },
      deps,
    );
    expect(result.decision.kind).toBe('skip');
    expect(result.record).toBeNull();
    expect(deps.calls.length).toBe(0);
  });

  test('quiet-hours defers without firing lanes', async () => {
    const deps = buildDeps();
    deps.policy = { quietHours: { startHour: 9, endHour: 22, tzOffsetMinutes: 0 } };
    const overnight = new Date('2026-05-12T03:00:00Z').getTime();
    const result = await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: overnight,
        enteredStatusAt: overnight - 48 * HOUR,
      },
      { taskTitle: 'review me' },
      deps,
    );
    expect(result.decision.kind).toBe('defer');
    expect(result.record).toBeNull();
  });
});

describe('observeIdleTask · spawn', () => {
  test('fires 3 lanes in declared persona order with mapped roles', async () => {
    const deps = buildDeps();
    const result = await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'OKR review' },
      deps,
    );
    expect(result.decision.kind).toBe('nudge');
    expect(deps.calls.length).toBe(3);
    expect(deps.calls.map((c) => c.role)).toEqual(['review', 'plan', 'reflect']);
    const record = result.record!;
    expect(record.lanes.map((l) => l.persona)).toEqual([...NUDGE_LANE_PERSONAS]);
    expect(record.showroomSessionId).toBe('showroom:nudge-t-1');
  });

  test('records nudge timestamp in history store after fire', async () => {
    const deps = buildDeps();
    await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    const after = await deps.history.get('t-1');
    expect(after.recentNudgesAt.length).toBe(1);
    expect(after.recentNudgesAt[0]).toBe(1_000_000);
  });

  test('onNudgeRecord callback fires once per nudge', async () => {
    const seen: unknown[] = [];
    const deps = buildDeps({ emit: (r) => seen.push(r) });
    await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    expect(seen.length).toBe(1);
  });

  test('per-persona model pin reaches lane calls', async () => {
    const deps = buildDeps();
    deps.models = { analyzer: 'claude', proposer: 'gemini', motivator: 'codex' };
    await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    expect(deps.calls.map((c) => c.model)).toEqual(['claude', 'gemini', 'codex']);
  });

  test('recentActivity is woven into the prompt body', async () => {
    const deps = buildDeps();
    await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x', recentActivity: 'shipped 2 PRs · context-switched 4 times' },
      deps,
    );
    expect(deps.calls[0]!.prompt).toContain('Recent user activity:');
    expect(deps.calls[0]!.prompt).toContain('context-switched 4 times');
  });

  test('lane callable throw becomes a [lane-error: ...] text without aborting the showroom', async () => {
    let calls = 0;
    const deps = buildDeps({
      callable: async () => {
        calls++;
        if (calls === 2) throw new Error('local LLM dropped');
        return { text: 'ok', modelId: 'qwen-7b' };
      },
    });
    const result = await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    const record = result.record!;
    expect(record.lanes[1]!.text).toContain('[lane-error: local LLM dropped]');
    expect(record.lanes.length).toBe(3);
  });

  test('rate-limit short-circuits subsequent observations', async () => {
    const deps = buildDeps();
    await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    const second = await observeIdleTask(
      {
        taskId: 't-1',
        status: 'review',
        observedAt: 1_000_000 + 2 * HOUR,
        enteredStatusAt: 1_000_000 - 48 * HOUR,
      },
      { taskTitle: 'x' },
      deps,
    );
    expect(second.decision.kind).toBe('skip');
    expect(second.record).toBeNull();
  });
});
