import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreTurnContext, CoreTurnResult } from './types.js';
import { debug } from '../debug/log.js';
import { boundReadableText } from '../self-implement/orchestrator.js';
import {
  CHILD_LIVENESS_HEARTBEAT_ENV,
  GOAL_LOOP_FINAL_TEXT_EXCERPT_MAX_CHARS,
  mergeChildLivenessHeartbeat,
  startChildLivenessHeartbeat,
  runGoalLoop,
} from './run-goal-loop.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function baseCtx(): CoreTurnContext {
  return {
    sessionId: 'child-liveness',
    messages: [{ role: 'user', content: 'implement x' }],
    tools: [],
    dispatchTool: async () => null,
    signal: new AbortController().signal,
  } as CoreTurnContext;
}

describe('startChildLivenessHeartbeat — 갈림 ① ㉢ workspace file', () => {
  test('overwrites a fixed file on an unref schedule, writes no screen, and stops cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'child-liveness-'));
    dirs.push(dir);
    const path = join(dir, 'liveness.hb');
    let now = 1_000;
    const stop = startChildLivenessHeartbeat({ path, intervalMs: 20, nowMs: () => now });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ at: 1_000 });
    now = 2_000;
    await Bun.sleep(55);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ at: 2_000 });
    stop();
    const frozen = readFileSync(path, 'utf8');
    now = 3_000;
    await Bun.sleep(55);
    expect(readFileSync(path, 'utf8')).toBe(frozen);
  });

  test('is a no-op without a path so a child that never speaks stays on the legacy timeout path', () => {
    const stop = startChildLivenessHeartbeat({ env: {} as NodeJS.ProcessEnv });
    stop();
  });

  test('records why the workspace file was chosen over screen markers and observation-store reads', async () => {
    const src = await Bun.file(join(import.meta.dir, 'child-liveness-heartbeat.ts')).text();
    expect(src).toContain('갈림 ① ㉢');
    expect(src).toContain('timer.unref()');
    expect(src).not.toContain('queryObservationStore');
    expect(src).not.toContain('emitScreenMarker');
    expect(src).toContain(CHILD_LIVENESS_HEARTBEAT_ENV);
    expect(src).toContain('갈림 ② ㉠');
  });
});

describe('mergeChildLivenessHeartbeat — stopped file is not live activity', () => {
  test('refreshes only when at is strictly newer; equal/older/missing stay stale', () => {
    expect(mergeChildLivenessHeartbeat(undefined, 10)).toEqual({ lastSeenAt: 10, refresh: true });
    expect(mergeChildLivenessHeartbeat(10, 11)).toEqual({ lastSeenAt: 11, refresh: true });
    expect(mergeChildLivenessHeartbeat(11, 11)).toEqual({ lastSeenAt: 11, refresh: false });
    expect(mergeChildLivenessHeartbeat(11, 9)).toEqual({ lastSeenAt: 11, refresh: false });
    expect(mergeChildLivenessHeartbeat(11, undefined)).toEqual({ lastSeenAt: 11, refresh: false });
    expect(mergeChildLivenessHeartbeat(undefined, undefined)).toEqual({ lastSeenAt: undefined, refresh: false });
  });
});

type GoalLoopIterationObservation = Record<string, unknown>;

async function collectIterationObservation(finalText: string): Promise<GoalLoopIterationObservation> {
  const observations: GoalLoopIterationObservation[] = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data: Record<string, unknown>) => {
    if (category === 'goal.loop' && event === 'iteration') observations.push(data);
  }) as typeof debug.log;
  try {
    await runGoalLoop(baseCtx(), {
      maxIterations: 1,
      runTurn: async () => ({ stopReason: 'end_turn', finalText } satisfies CoreTurnResult),
    });
  } finally {
    debug.log = originalLog;
  }
  expect(observations).toHaveLength(1);
  return observations[0]!;
}

describe('runGoalLoop iteration observation final-text excerpt', () => {
  test('preserves a fitting final text and existing iteration fields', async () => {
    const finalText = 'completed focused implementation';
    const observation = await collectIterationObservation(finalText);

    expect(observation).toMatchObject({
      iteration: 1,
      stopReason: 'end_turn',
      toolActivity: false,
      finalChars: finalText.length,
      finalTextExcerpt: finalText,
      finalTextExcerptTruncated: false,
    });
  });

  test('bounds a long final text with boundReadableText while retaining original finalChars', async () => {
    const finalText = 'x'.repeat(GOAL_LOOP_FINAL_TEXT_EXCERPT_MAX_CHARS + 1);
    const expected = boundReadableText(finalText, GOAL_LOOP_FINAL_TEXT_EXCERPT_MAX_CHARS);
    const observation = await collectIterationObservation(finalText);

    expect(observation).toMatchObject({
      finalChars: finalText.length,
      finalTextExcerpt: expected.text,
      finalTextExcerptTruncated: true,
    });
    expect((observation.finalTextExcerpt as string).length).toBeLessThanOrEqual(GOAL_LOOP_FINAL_TEXT_EXCERPT_MAX_CHARS);
  });

  test('records an empty final text as an untruncated empty excerpt', async () => {
    const observation = await collectIterationObservation('');

    expect(observation).toMatchObject({
      finalChars: 0,
      finalTextExcerpt: '',
      finalTextExcerptTruncated: false,
    });
  });
});

describe('runGoalLoop wires file-heartbeat emission before waiting', () => {
  test('starts the helper before the first model/tool wait and detaches on completion', async () => {
    const order: string[] = [];
    await runGoalLoop(baseCtx(), {
      startLivenessHeartbeat: () => {
        order.push('start');
        return () => { order.push('stop'); };
      },
      runTurn: async () => {
        order.push('turn');
        return { stopReason: 'end_turn', finalText: 'ok' } satisfies CoreTurnResult;
      },
    });
    expect(order).toEqual(['start', 'turn', 'stop']);
  });

  test('detaches the helper when runTurn throws', async () => {
    const order: string[] = [];
    await expect(runGoalLoop(baseCtx(), {
      startLivenessHeartbeat: () => {
        order.push('start');
        return () => { order.push('stop'); };
      },
      runTurn: async () => {
        order.push('turn');
        throw new Error('boom');
      },
    })).rejects.toThrow('boom');
    expect(order).toEqual(['start', 'turn', 'stop']);
  });
});
