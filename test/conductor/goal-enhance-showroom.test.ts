// W6 Z9 · goal enhance showroom · reducer + 3-lane orchestrator + timeout/fallback.

import { describe, expect, test } from 'bun:test';
import {
  runGoalEnhanceShowroom,
  type GoalEnhanceLaneRole,
} from '../../src/conductor/goal-enhance-showroom';
import { reduceEnhancement } from '../../src/conductor/goal-enhance-reducer';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';

const ROLE_ANSWERS: Record<GoalEnhanceLaneRole, string> = {
  'clarifier': 'Launch the Q3 demo to internal stakeholders.',
  'outcome-definer': 'Demo runs end-to-end on the staging cluster for 30 min without manual restart.',
  'constraint-surfacer': '- Deadline Friday\n- Staging cluster only\n- No production data\n- Two engineer review',
};

function fakeCallable(answers: Record<string, string>): ShowroomLaneCallable {
  // showroom role mapping: clarifier→reflect · outcome-definer→plan · constraint-surfacer→review
  return async (input) => {
    const enhanceRole = input.role === 'reflect'
      ? 'clarifier'
      : input.role === 'plan'
      ? 'outcome-definer'
      : 'constraint-surfacer';
    return { text: answers[enhanceRole] ?? '', modelId: input.model };
  };
}

describe('reduceEnhancement (pure reducer)', () => {
  test('merges clarifier + outcome into smartGoal with constraints', () => {
    const reduced = reduceEnhancement('launch demo', [
      { role: 'clarifier', out: { text: ROLE_ANSWERS.clarifier } },
      { role: 'outcome-definer', out: { text: ROLE_ANSWERS['outcome-definer'] } },
      { role: 'constraint-surfacer', out: { text: ROLE_ANSWERS['constraint-surfacer'] } },
    ]);
    expect(reduced.goal).toBe('launch demo');
    expect(reduced.smartGoal).toContain('Launch the Q3 demo');
    expect(reduced.smartGoal).toContain('Outcome: Demo runs end-to-end');
    expect(reduced.constraints).toEqual(['Deadline Friday', 'Staging cluster only', 'No production data', 'Two engineer review']);
    expect(reduced.outcome).toContain('Demo runs');
  });

  test('clarifier-only → smartGoal = clarifier; constraints empty', () => {
    const reduced = reduceEnhancement('g', [
      { role: 'clarifier', out: { text: 'Clarified goal text.' } },
    ]);
    expect(reduced.smartGoal).toBe('Clarified goal text.');
    expect(reduced.constraints).toEqual([]);
  });

  test('caps constraints at 5', () => {
    const many = Array.from({ length: 10 }, (_, i) => `- item ${i}`).join('\n');
    const reduced = reduceEnhancement('g', [
      { role: 'constraint-surfacer', out: { text: many } },
    ]);
    expect(reduced.constraints.length).toBe(5);
  });

  test('falls back to non-bulleted lines when no bullets present', () => {
    const reduced = reduceEnhancement('g', [
      { role: 'constraint-surfacer', out: { text: 'plain line one\nplain line two' } },
    ]);
    expect(reduced.constraints).toEqual(['plain line one', 'plain line two']);
  });
});

describe('runGoalEnhanceShowroom', () => {
  test('all 3 lanes succeed → enhanced=true + reducer applied', async () => {
    const callable = fakeCallable(ROLE_ANSWERS);
    const out = await runGoalEnhanceShowroom({ goal: 'launch demo' }, { laneCallable: callable });
    expect(out.enhanced).toBe(true);
    expect(out.lanes.length).toBe(3);
    expect(out.goal.smartGoal).toContain('Outcome:');
    expect(out.goal.constraints.length).toBe(4);
    expect(out.fallbackReason).toBeUndefined();
  });

  test('any lane error → graceful degradation (original goal preserved)', async () => {
    const callable: ShowroomLaneCallable = async (input) => {
      if (input.role === 'review') throw new Error('boom');
      return { text: 'ok' };
    };
    const out = await runGoalEnhanceShowroom({ goal: 'raw goal' }, { laneCallable: callable });
    expect(out.enhanced).toBe(false);
    expect(out.fallbackReason).toBe('lane-error');
    expect(out.goal.smartGoal).toBe('raw goal');
    expect(out.goal.constraints).toEqual([]);
    expect(out.lanes.length).toBe(2); // 2 settled, 1 rejected
  });

  test('timeout → enhanced=false with fallbackReason=timeout', async () => {
    let aborted = false;
    const callable: ShowroomLaneCallable = (input) => new Promise((_resolve, reject) => {
      input.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    });
    const out = await runGoalEnhanceShowroom(
      { goal: 'slow' },
      { laneCallable: callable, timeoutMs: 20 },
    );
    expect(out.enhanced).toBe(false);
    expect(out.fallbackReason).toBe('timeout');
    expect(out.goal.smartGoal).toBe('slow');
    expect(aborted).toBe(true);
  });

  test('model pins override defaults', async () => {
    const seenModels: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seenModels.push(input.model);
      return { text: 't', modelId: input.model };
    };
    await runGoalEnhanceShowroom(
      { goal: 'g' },
      {
        laneCallable: callable,
        models: { 'clarifier': 'gpt-4', 'outcome-definer': 'claude-opus', 'constraint-surfacer': 'gemini-pro' },
      },
    );
    expect(seenModels.sort()).toEqual(['claude-opus', 'gemini-pro', 'gpt-4']);
  });

  test('context is appended to every lane prompt', async () => {
    const seenPrompts: string[] = [];
    const callable: ShowroomLaneCallable = async (input) => {
      seenPrompts.push(input.prompt);
      return { text: 'ok' };
    };
    await runGoalEnhanceShowroom(
      { goal: 'g', context: 'user is in office focus mode' },
      { laneCallable: callable },
    );
    expect(seenPrompts.every((p) => p.includes('user is in office focus mode'))).toBe(true);
  });
});
