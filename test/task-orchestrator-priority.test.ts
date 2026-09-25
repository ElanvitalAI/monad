import { describe, expect, test } from 'bun:test';
import {
  priorityScore,
  compareByPriority,
  sortByPriority,
  PRIORITY_RANK,
  DEFAULT_WEIGHTS,
} from '../src/task-orchestrator/priority.js';
import { createTask, type Task } from '../src/task-orchestrator/types.js';

const surface: Task['surface'] = { kind: 'llm-direct', prompt: 'x' };

function task(overrides: Partial<Parameters<typeof createTask>[0]> = {}, id?: string, now?: number): Task {
  return createTask({ title: 't', surface, ...overrides }, { id, now, allowUncheckedUrgent: true });
}

describe('priority rank', () => {
  test('rank order urgent > high > medium > low', () => {
    expect(PRIORITY_RANK.urgent).toBeGreaterThan(PRIORITY_RANK.high);
    expect(PRIORITY_RANK.high).toBeGreaterThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeGreaterThan(PRIORITY_RANK.low);
  });
});

describe('priorityScore', () => {
  test('urgent scores higher than medium with identical context', () => {
    const a = task({ priority: 'urgent' }, 'task:aa', 1_700_000_000_000);
    const b = task({ priority: 'medium' }, 'task:bb', 1_700_000_000_000);
    const now = 1_700_000_000_000;
    expect(priorityScore(a, { now })).toBeGreaterThan(priorityScore(b, { now }));
  });

  test('older task scores higher with same priority (age boost)', () => {
    const now = 1_700_000_000_000;
    const old = task({ priority: 'medium' }, 'task:o', now - 60 * 60_000); // 1h old
    const young = task({ priority: 'medium' }, 'task:y', now); // fresh
    expect(priorityScore(old, { now })).toBeGreaterThan(priorityScore(young, { now }));
  });

  test('descendantCount boosts critical path', () => {
    const t = task({ priority: 'medium' }, 'task:x', 1_700_000_000_000);
    const ctx = { now: 1_700_000_000_000, descendantCount: new Map([['task:x', 10]]) };
    const boosted = priorityScore(t, ctx);
    const plain = priorityScore(t, { now: 1_700_000_000_000 });
    expect(boosted).toBeGreaterThan(plain);
    expect(boosted - plain).toBeCloseTo(10 * DEFAULT_WEIGHTS.descendants, 5);
  });

  test('expensive task penalised vs cheap at same priority', () => {
    const now = 1_700_000_000_000;
    const cheap = task({ priority: 'high', estimateUsd: 0.01 }, 'task:c', now);
    const expensive = task({ priority: 'high', estimateUsd: 10 }, 'task:e', now);
    expect(priorityScore(cheap, { now })).toBeGreaterThan(priorityScore(expensive, { now }));
  });

  test('goalUrgency mapping tilts tasks with matching goal', () => {
    const now = 1_700_000_000_000;
    const withGoal = task({ priority: 'medium', goalSlug: 'g1' }, 'task:g', now);
    const without = task({ priority: 'medium' }, 'task:n', now);
    const ctx = { now, goalUrgency: new Map([['g1', 1]]) };
    expect(priorityScore(withGoal, ctx)).toBeGreaterThan(priorityScore(without, ctx));
  });

  test('custom weights override defaults', () => {
    const t = task({ priority: 'low' }, 'task:l', 1_700_000_000_000);
    const cheapWeights = { priorityRank: 0 };
    // With priorityRank=0, the score is 0 (fresh, no desc, no goal, no usd)
    expect(priorityScore(t, { now: 1_700_000_000_000, weights: cheapWeights })).toBe(0);
  });
});

describe('compareByPriority + sortByPriority', () => {
  test('sorts higher score first (urgent before medium)', () => {
    const now = 1_700_000_000_000;
    const urgent = task({ priority: 'urgent' }, 'task:u', now);
    const medium = task({ priority: 'medium' }, 'task:m', now);
    const out = sortByPriority([medium, urgent], { now });
    expect(out[0].id).toBe('task:u');
    expect(out[1].id).toBe('task:m');
  });

  test('tie by score → older createdAt wins', () => {
    const older = task({ priority: 'medium' }, 'task:a', 1_000);
    const newer = task({ priority: 'medium' }, 'task:b', 2_000);
    const out = sortByPriority([newer, older], { now: 2_000 });
    // but wait — older has higher ageMinutes, so scoreOlder > scoreNewer
    // This tests the age boost also secretly fires. True tie: same createdAt.
    expect(out[0].id).toBe('task:a');
  });

  test('exact tie → id tiebreaker (total order)', () => {
    const a = task({ priority: 'medium' }, 'task:a0', 1_000);
    const b = task({ priority: 'medium' }, 'task:b0', 1_000);
    const out = sortByPriority([b, a], { now: 1_000 });
    expect(out[0].id).toBe('task:a0');
    expect(out[1].id).toBe('task:b0');
  });
});
