import { describe, expect, test } from 'bun:test';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import {
  summarizeGoal,
  formatGoalSummaryLine,
  formatGoalSummaryMarkdown,
} from '../src/task-orchestrator/goal-summary.ts';
import {
  createTask,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskSurface,
} from '../src/task-orchestrator/types.ts';

const surface: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mk(opts: {
  id?: string;
  title?: string;
  goalSlug?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  createdAt?: number;
  estimateUsd?: number;
}): Task {
  const t = createTask(
    {
      title: opts.title ?? 't',
      surface,
      goalSlug: opts.goalSlug,
      priority: opts.priority,
      estimateUsd: opts.estimateUsd,
    },
    {
      id: opts.id ? `task:${opts.id}` : undefined,
      now: opts.createdAt ?? 1000,
      allowUncheckedUrgent: true,
    },
  );
  if (opts.status) t.status = opts.status;
  return t;
}

describe('summarizeGoal', () => {
  test('G1: empty goal → zeros, null fields', () => {
    const g = new TaskGraph();
    const s = summarizeGoal(g, 'nope');
    expect(s.total).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.nextReady).toBeNull();
    expect(s.lastActivity).toBeNull();
    expect(s.ageOldestOpenMs).toBeNull();
  });

  test('G2: single backlog task → total 1, progress 0', () => {
    const g = new TaskGraph();
    g.addTask(mk({ goalSlug: 'g1' }));
    const s = summarizeGoal(g, 'g1');
    expect(s.total).toBe(1);
    expect(s.counts.backlog).toBe(1);
    expect(s.progress).toBe(0);
  });

  test('G3: mixed statuses counted correctly', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g', status: 'backlog' }));
    g.addTask(mk({ id: 'b', goalSlug: 'g', status: 'ready' }));
    g.addTask(mk({ id: 'c', goalSlug: 'g', status: 'running' }));
    g.addTask(mk({ id: 'd', goalSlug: 'g', status: 'done' }));
    g.addTask(mk({ id: 'e', goalSlug: 'g', status: 'failed' }));
    const s = summarizeGoal(g, 'g');
    expect(s.counts.backlog).toBe(1);
    expect(s.counts.ready).toBe(1);
    expect(s.counts.running).toBe(1);
    expect(s.counts.done).toBe(1);
    expect(s.counts.failed).toBe(1);
    expect(s.total).toBe(5);
  });

  test('G4: progress = done/total', () => {
    const g = new TaskGraph();
    for (let i = 0; i < 3; i++) {
      g.addTask(mk({ id: `d${i}`, goalSlug: 'g', status: 'done' }));
    }
    for (let i = 0; i < 2; i++) {
      g.addTask(mk({ id: `p${i}`, goalSlug: 'g', status: 'backlog' }));
    }
    const s = summarizeGoal(g, 'g');
    expect(s.progress).toBeCloseTo(3 / 5);
  });

  test('G5: cancelled + superseded excluded from total', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g' }));
    g.addTask(mk({ id: 'b', goalSlug: 'g', status: 'cancelled' }));
    g.addTask(mk({ id: 'c', goalSlug: 'g' }));
    // supersede needs replacement; use graph api
    const sup = mk({ id: 'd', goalSlug: 'g' });
    g.addTask(sup);
    g.supersede(sup.id, []);
    const s = summarizeGoal(g, 'g');
    // 'a' + 'c' in total (b cancelled, d superseded → excluded)
    expect(s.total).toBe(2);
    // listByGoal excludes superseded so counts.superseded is 0
    expect(s.counts.cancelled).toBe(1);
  });

  test('G6: estimateUsdTotal sums task.estimateUsd', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g', estimateUsd: 0.1 }));
    g.addTask(mk({ id: 'b', goalSlug: 'g', estimateUsd: 0.25 }));
    g.addTask(mk({ id: 'c', goalSlug: 'g' })); // no estimate
    const s = summarizeGoal(g, 'g');
    expect(s.estimateUsdTotal).toBeCloseTo(0.35);
  });

  test('G7: actualUsdTotal uses store hook', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g' }));
    const s = summarizeGoal(g, 'g', {
      store: {
        listExecutionsForGoal: () => [{ costUsd: 0.12 }, { costUsd: 0.08 }, { costUsd: undefined }],
      },
    });
    expect(s.actualUsdTotal).toBeCloseTo(0.2);
  });

  test('G8: actualUsdTotal = 0 when no store', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g' }));
    const s = summarizeGoal(g, 'g');
    expect(s.actualUsdTotal).toBe(0);
  });

  test('G9: nextReady picks urgent over medium', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'm', goalSlug: 'g', status: 'ready', priority: 'medium' }));
    g.addTask(mk({ id: 'u', goalSlug: 'g', status: 'ready', priority: 'urgent' }));
    const s = summarizeGoal(g, 'g');
    expect(s.nextReady?.id).toBe('task:u');
    expect(s.nextReady?.priority).toBe('urgent');
  });

  test('G10: nextReady tie-break older createdAt first', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'newer', goalSlug: 'g', status: 'ready', createdAt: 2000 }));
    g.addTask(mk({ id: 'older', goalSlug: 'g', status: 'ready', createdAt: 1000 }));
    const s = summarizeGoal(g, 'g');
    expect(s.nextReady?.id).toBe('task:older');
  });

  test('G11: ageOldestOpenMs = now - oldest non-terminal createdAt', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'o', goalSlug: 'g', status: 'backlog', createdAt: 500 }));
    g.addTask(mk({ id: 'r', goalSlug: 'g', status: 'running', createdAt: 800 }));
    g.addTask(mk({ id: 'd', goalSlug: 'g', status: 'done', createdAt: 100 })); // done excluded from open
    const s = summarizeGoal(g, 'g', { now: 2000 });
    expect(s.ageOldestOpenMs).toBe(1500); // 2000 - 500
  });
});

describe('formatGoalSummaryLine', () => {
  test('F1: includes progress + pct + next title', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g', status: 'done' }));
    g.addTask(mk({ id: 'b', goalSlug: 'g', status: 'ready', title: 'Fetch' }));
    const s = summarizeGoal(g, 'g');
    const line = formatGoalSummaryLine(s);
    expect(line).toContain('1/2 done');
    expect(line).toContain('50%');
    expect(line).toContain('next: Fetch');
  });

  test('F2: cost fragment hidden when both zero', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g' }));
    const line = formatGoalSummaryLine(summarizeGoal(g, 'g'));
    expect(line).not.toContain('$');
  });
});

describe('formatGoalSummaryMarkdown', () => {
  test('M1: includes goal header + counts + next-ready', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g', status: 'ready', title: 'Do it' }));
    const md = formatGoalSummaryMarkdown(summarizeGoal(g, 'g'));
    expect(md).toContain('## Goal: g');
    expect(md).toContain('next-ready:');
    expect(md).toContain('Do it');
  });

  test('M2: "(none)" when no next-ready', () => {
    const g = new TaskGraph();
    g.addTask(mk({ id: 'a', goalSlug: 'g', status: 'done' }));
    const md = formatGoalSummaryMarkdown(summarizeGoal(g, 'g'));
    expect(md).toContain('(none)');
  });
});
