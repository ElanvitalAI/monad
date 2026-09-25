import { describe, expect, test } from 'bun:test';
import { computeBoard } from '../src/task-orchestrator/board/layout.ts';
import {
  createTask,
  type Task,
  type TaskStatus,
  type TaskSurface,
} from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };
const surfaceSkill: TaskSurface = { kind: 'skill', skillName: 'omni-crawl' };

function mk(opts: {
  title?: string;
  status?: TaskStatus;
  surface?: TaskSurface;
  priority?: Parameters<typeof createTask>[0]['priority'];
  goalSlug?: string;
  createdAt?: number;
} = {}): Task {
  const t = createTask(
    {
      title: opts.title ?? 't',
      surface: opts.surface ?? surfaceLlm,
      priority: opts.priority,
      goalSlug: opts.goalSlug,
    },
    { now: opts.createdAt ?? 1000, allowUncheckedUrgent: true },
  );
  if (opts.status) t.status = opts.status;
  return t;
}

const WIDE = { width: 180, height: 40 };
const GRID = { width: 80, height: 30 };
const COMPACT = { width: 40, height: 20 };

describe('computeBoard', () => {
  test('L1: 4 columns always present, empty input', () => {
    const layout = computeBoard({ tasks: [], viewport: WIDE, now: 10_000 });
    expect(layout.columns.map((c) => c.key)).toEqual([
      'BACKLOG',
      'IN_PROGRESS',
      'REVIEW',
      'DONE',
    ]);
    expect(layout.stats.total).toBe(0);
    expect(layout.stats.ageOldestMs).toBeNull();
  });

  test('L2: status → column routing', () => {
    const tasks = [
      mk({ status: 'backlog' }),
      mk({ status: 'blocked' }),
      mk({ status: 'ready' }),
      mk({ status: 'running' }),
      mk({ status: 'review' }),
      mk({ status: 'failed' }),
      mk({ status: 'done' }),
      mk({ status: 'cancelled' }), // archived — excluded
    ];
    const layout = computeBoard({ tasks, viewport: WIDE, now: 5000 });
    const byKey = Object.fromEntries(layout.columns.map((c) => [c.key, c.total]));
    expect(byKey.BACKLOG).toBe(3); // backlog + blocked + ready
    expect(byKey.IN_PROGRESS).toBe(1);
    expect(byKey.REVIEW).toBe(2); // review + failed
    expect(byKey.DONE).toBe(1);
    expect(layout.stats.total).toBe(7); // cancelled excluded
  });

  test('L3: DONE 24h cutoff archives old done tasks', () => {
    const now = 1_000_000;
    const old = mk({ status: 'done', createdAt: now - 25 * 60 * 60 * 1000 });
    const recent = mk({ status: 'done', createdAt: now - 1 * 60 * 60 * 1000 });
    const layout = computeBoard({ tasks: [old, recent], viewport: WIDE, now });
    const done = layout.columns.find((c) => c.key === 'DONE')!;
    expect(done.total).toBe(1);
    expect(done.cards[0]!.id).toBe(recent.id);
  });

  test('L4: filter goalSlug', () => {
    const tasks = [
      mk({ goalSlug: 'g1' }),
      mk({ goalSlug: 'g2' }),
      mk({ goalSlug: 'g1' }),
    ];
    const layout = computeBoard({
      tasks,
      viewport: WIDE,
      filter: { goalSlug: 'g1' },
      now: 5000,
    });
    expect(layout.stats.total).toBe(2);
  });

  test('L5: filter surfaceKind', () => {
    const tasks = [
      mk({ surface: surfaceLlm }),
      mk({ surface: surfaceSkill }),
      mk({ surface: surfaceSkill }),
    ];
    const layout = computeBoard({
      tasks,
      viewport: WIDE,
      filter: { surfaceKind: 'skill' },
      now: 5000,
    });
    expect(layout.stats.total).toBe(2);
  });

  test('L6: filter text substring (case-insensitive)', () => {
    const tasks = [
      mk({ title: 'Fix the bug' }),
      mk({ title: 'Add feature' }),
      mk({ title: 'another BUG fix' }),
    ];
    const layout = computeBoard({
      tasks,
      viewport: WIDE,
      filter: { text: 'bug' },
      now: 5000,
    });
    expect(layout.stats.total).toBe(2);
  });

  test('L7: wide mode when width >= 120', () => {
    const layout = computeBoard({ tasks: [], viewport: { width: 120, height: 20 }, now: 0 });
    expect(layout.mode).toBe('wide');
  });

  test('L8: grid mode (60-119)', () => {
    const layout = computeBoard({ tasks: [], viewport: GRID, now: 0 });
    expect(layout.mode).toBe('grid');
  });

  test('L9: compact mode (<60) with per-column cap', () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      mk({ status: 'backlog', title: `t${i}` }),
    );
    const layout = computeBoard({
      tasks,
      viewport: COMPACT,
      now: 5000,
      compactPerColumn: 5,
    });
    expect(layout.mode).toBe('compact');
    const backlog = layout.columns.find((c) => c.key === 'BACKLOG')!;
    expect(backlog.cards.length).toBe(5);
    expect(backlog.total).toBe(15);
    expect(layout.overflow.BACKLOG).toBe(10);
  });

  test('L10: overflow = 0 when no cap applied (wide)', () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      mk({ status: 'backlog', title: `t${i}` }),
    );
    const layout = computeBoard({ tasks, viewport: WIDE, now: 5000 });
    const backlog = layout.columns.find((c) => c.key === 'BACKLOG')!;
    expect(backlog.cards.length).toBe(20);
    expect(layout.overflow.BACKLOG).toBe(0);
  });

  test('L11: priority sort — urgent first', () => {
    const tasks = [
      mk({ status: 'backlog', title: 'low', priority: 'low', createdAt: 100 }),
      mk({ status: 'backlog', title: 'urgent', priority: 'urgent', createdAt: 200 }),
      mk({ status: 'backlog', title: 'medium', priority: 'medium', createdAt: 150 }),
    ];
    const layout = computeBoard({ tasks, viewport: WIDE, now: 5000 });
    const titles = layout.columns.find((c) => c.key === 'BACKLOG')!.cards.map((c) => c.title);
    expect(titles).toEqual(['urgent', 'medium', 'low']);
  });

  test('L12: stats.ageOldestMs = now - min createdAt', () => {
    const tasks = [
      mk({ status: 'backlog', createdAt: 500 }),
      mk({ status: 'running', createdAt: 300 }),
      mk({ status: 'done', createdAt: 100 }),
    ];
    const layout = computeBoard({ tasks, viewport: WIDE, now: 1000 });
    // done older than 24h? no — cutoff is 24h = 24*60*60*1000. 100 < 1000, so age = 900ms.
    expect(layout.stats.ageOldestMs).toBe(900);
  });
});
