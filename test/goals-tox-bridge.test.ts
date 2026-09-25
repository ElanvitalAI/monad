// TOX ↔ /goal bridge tests — FU-7.

import { describe, expect, test } from 'bun:test';
import {
  findCandidateTasks,
  formatLinkedTaskLine,
  summarizeLinkedTask,
  type TaskLike,
  type TaskStoreLike,
} from '../src/goals/tox-bridge.js';
import type { Goal } from '../src/goals/types.js';

const sampleGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: 'g-1',
  objective: 'fix bug',
  mode: 'judge',
  status: 'active',
  createdAt: 0,
  updatedAt: 0,
  budget: { maxTurns: 20, wallClockMaxMs: 0, tokenBudget: 0 },
  usage: { turnsUsed: 0, tokensUsed: 0, tokensMeasured: true, elapsedMs: 0 },
  ...overrides,
});

class FakeStore implements TaskStoreLike {
  constructor(private tasks: TaskLike[]) {}
  getTask(id: string): TaskLike | null {
    return this.tasks.find((t) => t.id === id) ?? null;
  }
  listTasks(opts: { goalSlug?: string }): TaskLike[] {
    if (opts.goalSlug !== undefined) {
      return this.tasks.filter((t) => t.goalSlug === opts.goalSlug);
    }
    return this.tasks;
  }
}

describe('summarizeLinkedTask', () => {
  test('returns null when goal has no linkedTaskId', () => {
    const store = new FakeStore([]);
    expect(summarizeLinkedTask(sampleGoal(), store)).toBeNull();
  });

  test('returns null when task not found', () => {
    const store = new FakeStore([]);
    const goal = sampleGoal({ linkedTaskId: 'task:missing' });
    expect(summarizeLinkedTask(goal, store)).toBeNull();
  });

  test('returns summary when task exists', () => {
    const store = new FakeStore([
      { id: 'task:abc', title: 'Fix the auth bug', status: 'ready', goalSlug: 'fix-auth' },
    ]);
    const goal = sampleGoal({ linkedTaskId: 'task:abc' });
    const r = summarizeLinkedTask(goal, store);
    expect(r).toEqual({ id: 'task:abc', title: 'Fix the auth bug', status: 'ready', goalSlug: 'fix-auth' });
  });

  test('omits goalSlug when not set on task', () => {
    const store = new FakeStore([
      { id: 'task:xyz', title: 'Add docs', status: 'doing' },
    ]);
    const goal = sampleGoal({ linkedTaskId: 'task:xyz' });
    const r = summarizeLinkedTask(goal, store);
    expect(r?.goalSlug).toBeUndefined();
  });
});

describe('findCandidateTasks', () => {
  const tasks: TaskLike[] = [
    { id: 'task:1', title: 'Fix auth bug',     status: 'ready',  goalSlug: 'fix-auth' },
    { id: 'task:2', title: 'Add ralph loop',   status: 'doing',  goalSlug: 'add-ralph' },
    { id: 'task:3', title: 'Refactor state',   status: 'done' },
    { id: 'task:4', title: 'Add docs',         status: 'ready',  description: 'fix the typo in auth docs' },
  ];
  const store = new FakeStore(tasks);

  test('matches by goalSlug prefix derived from objective', () => {
    const r = findCandidateTasks('fix auth bug', store);
    expect(r.map((t) => t.id)).toContain('task:1');
  });

  test('falls back to title substring match', () => {
    const r = findCandidateTasks('refactor', store);
    expect(r.map((t) => t.id)).toContain('task:3');
  });

  test('also matches in description', () => {
    const r = findCandidateTasks('typo', store);
    expect(r.map((t) => t.id)).toContain('task:4');
  });

  test('returns empty for empty objective', () => {
    expect(findCandidateTasks('   ', store)).toEqual([]);
  });

  test('respects limit', () => {
    const r = findCandidateTasks('a', store, 2);
    expect(r.length).toBeLessThanOrEqual(2);
  });
});

describe('formatLinkedTaskLine', () => {
  test('formats summary into a single line', () => {
    const out = formatLinkedTaskLine({
      id: 'task:abc',
      title: 'Fix the auth bug',
      status: 'ready',
      goalSlug: 'fix-auth',
    });
    expect(out).toContain('task:abc');
    expect(out).toContain('Fix the auth bug');
    expect(out).toContain('ready');
    expect(out).toContain('slug=fix-auth');
  });

  test('omits slug part when missing', () => {
    const out = formatLinkedTaskLine({ id: 'task:1', title: 'X', status: 'doing' });
    expect(out).not.toContain('slug=');
  });
});
