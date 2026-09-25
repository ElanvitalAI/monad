import { describe, expect, test } from 'bun:test';
import { TaskGraph, TaskGraphError, isValidTransition } from '../src/task-orchestrator/graph.js';
import { createTask, type Task } from '../src/task-orchestrator/types.js';

const surface: Task['surface'] = { kind: 'llm-direct', prompt: 'x' };

function make(idSuffix: string, overrides: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  return createTask(
    { title: `t-${idSuffix}`, surface, ...overrides },
    { id: `task:${idSuffix}`, allowUncheckedUrgent: true },
  );
}

describe('TaskGraph — CRUD basics', () => {
  test('addTask + getTask round trip', () => {
    const g = new TaskGraph();
    const t = make('a1');
    g.addTask(t);
    expect(g.hasTask('task:a1')).toBe(true);
    expect(g.getTask('task:a1')?.title).toBe('t-a1');
    expect(g.size()).toBe(1);
  });

  test('addTask throws on duplicate id', () => {
    const g = new TaskGraph();
    const t = make('dup');
    g.addTask(t);
    expect(() => g.addTask(t)).toThrow(TaskGraphError);
  });

  test('updateTask merges patch + bumps updatedAt', () => {
    const g = new TaskGraph();
    g.addTask(make('x', { priority: 'medium' }));
    const upd = g.updateTask('task:x', { priority: 'high' }, { now: 9_999 });
    expect(upd.priority).toBe('high');
    expect(upd.updatedAt).toBe(9_999);
    expect(upd.createdAt).not.toBe(9_999); // createdAt preserved
  });

  test('updateTask on missing id throws NOT_FOUND', () => {
    const g = new TaskGraph();
    expect(() => g.updateTask('task:nope', { priority: 'high' })).toThrow(/NOT_FOUND|not in graph/);
  });
});

describe('TaskGraph — status transitions', () => {
  test('valid transition backlog → ready → running → review → done', () => {
    const g = new TaskGraph();
    g.addTask(make('f1'));
    expect(() => g.updateTask('task:f1', { status: 'ready' })).not.toThrow();
    expect(() => g.updateTask('task:f1', { status: 'running' })).not.toThrow();
    expect(() => g.updateTask('task:f1', { status: 'review' })).not.toThrow();
    expect(() => g.updateTask('task:f1', { status: 'done' })).not.toThrow();
    expect(g.getTask('task:f1')?.status).toBe('done');
  });

  test('illegal transition done → running throws', () => {
    const g = new TaskGraph();
    g.addTask(make('d1', { status: 'done' }));
    expect(() => g.updateTask('task:d1', { status: 'running' })).toThrow(/INVALID_TRANSITION/);
  });

  test('self-transition (backlog → backlog) is idempotent, no throw', () => {
    const g = new TaskGraph();
    g.addTask(make('s'));
    expect(() => g.updateTask('task:s', { status: 'backlog' })).not.toThrow();
  });

  test('transition table: failed → ready allowed (retry path)', () => {
    expect(isValidTransition('failed', 'ready')).toBe(true);
    expect(isValidTransition('failed', 'done')).toBe(false);
  });
});

describe('TaskGraph — cycle detection', () => {
  test('detects 2-node cycle on addTask', () => {
    const g = new TaskGraph();
    g.addTask(make('a'));
    g.addTask(make('b', { dependsOn: ['task:a'] }));
    // Now try to update a to depend on b → cycle
    expect(() => g.updateTask('task:a', { dependsOn: ['task:b'] })).toThrow(/CYCLE_DETECTED/);
    // Ensure rollback — a's dependsOn is still empty
    expect(g.getTask('task:a')?.dependsOn).toEqual([]);
  });

  test('detects 3-node cycle on update', () => {
    const g = new TaskGraph();
    g.addTask(make('x'));
    g.addTask(make('y', { dependsOn: ['task:x'] }));
    g.addTask(make('z', { dependsOn: ['task:y'] }));
    // x → z would close z→y→x→z
    expect(() => g.updateTask('task:x', { dependsOn: ['task:z'] })).toThrow(/CYCLE_DETECTED/);
  });

  test('acyclic graph — detectCycle returns null', () => {
    const g = new TaskGraph();
    g.addTask(make('a'));
    g.addTask(make('b', { dependsOn: ['task:a'] }));
    g.addTask(make('c', { dependsOn: ['task:a', 'task:b'] }));
    expect(g.detectCycle()).toBeNull();
  });
});

describe('TaskGraph — ready set + promoteReady', () => {
  test('tasks with no deps auto-eligible', () => {
    const g = new TaskGraph();
    g.addTask(make('free'));
    const promoted = g.promoteReady();
    expect(promoted.map((t) => t.id)).toContain('task:free');
    expect(g.getTask('task:free')?.status).toBe('ready');
  });

  test('tasks with unmet deps stay blocked', () => {
    const g = new TaskGraph();
    g.addTask(make('dep')); // backlog
    g.addTask(make('child', { dependsOn: ['task:dep'] }));
    g.promoteReady();
    expect(g.getTask('task:child')?.status).toBe('blocked');
    expect(g.getTask('task:dep')?.status).toBe('ready'); // dep itself has no deps
  });

  test('readySet priority-sorted + limited', () => {
    const g = new TaskGraph();
    g.addTask(make('lo', { priority: 'low' }));
    g.addTask(make('hi', { priority: 'urgent' }));
    g.addTask(make('md', { priority: 'medium' }));
    g.promoteReady();
    const rs = g.readySet({ limit: 2 });
    expect(rs).toHaveLength(2);
    expect(rs[0].id).toBe('task:hi');
  });

  test('readySet surface filter', () => {
    const g = new TaskGraph();
    g.addTask(createTask({
      title: 'llm',
      surface: { kind: 'llm-direct', prompt: 'p' },
    }, { id: 'task:lllm' }));
    g.addTask(createTask({
      title: 'skill',
      surface: { kind: 'skill', skillName: 'omni-crawl' },
    }, { id: 'task:skil' }));
    g.promoteReady();
    const onlySkill = g.readySet({ surface: 'skill' });
    expect(onlySkill).toHaveLength(1);
    expect(onlySkill[0].id).toBe('task:skil');
  });
});

describe('TaskGraph — onCompleted propagation', () => {
  test('parent done unblocks child', () => {
    const g = new TaskGraph();
    g.addTask(make('p'));
    g.addTask(make('c', { dependsOn: ['task:p'] }));
    g.promoteReady(); // p: ready, c: blocked
    g.updateTask('task:p', { status: 'running' });
    g.updateTask('task:p', { status: 'review' });
    g.updateTask('task:p', { status: 'done' });
    const newly = g.onCompleted('task:p');
    expect(newly.map((t) => t.id)).toContain('task:c');
    expect(g.getTask('task:c')?.status).toBe('ready');
  });

  test('multi-dep child — unblocks only when all parents done', () => {
    const g = new TaskGraph();
    g.addTask(make('p1'));
    g.addTask(make('p2'));
    g.addTask(make('c', { dependsOn: ['task:p1', 'task:p2'] }));
    g.promoteReady();
    g.updateTask('task:p1', { status: 'running' });
    g.updateTask('task:p1', { status: 'review' });
    g.updateTask('task:p1', { status: 'done' });
    g.onCompleted('task:p1');
    expect(g.getTask('task:c')?.status).toBe('blocked');
    g.updateTask('task:p2', { status: 'running' });
    g.updateTask('task:p2', { status: 'review' });
    g.updateTask('task:p2', { status: 'done' });
    g.onCompleted('task:p2');
    expect(g.getTask('task:c')?.status).toBe('ready');
  });
});

describe('TaskGraph — subtree + goal index + counts', () => {
  test('subtree BFS traversal downstream', () => {
    const g = new TaskGraph();
    g.addTask(make('r'));
    g.addTask(make('m1', { dependsOn: ['task:r'] }));
    g.addTask(make('m2', { dependsOn: ['task:r'] }));
    g.addTask(make('leaf', { dependsOn: ['task:m1'] }));
    const sub = g.subtree('task:r');
    expect(sub.map((t) => t.id).sort()).toEqual(['task:leaf', 'task:m1', 'task:m2', 'task:r']);
  });

  test('listByGoal filters by goalSlug', () => {
    const g = new TaskGraph();
    g.addTask(make('a', { goalSlug: 'g1' }));
    g.addTask(make('b', { goalSlug: 'g1' }));
    g.addTask(make('c', { goalSlug: 'g2' }));
    expect(g.listByGoal('g1').map((t) => t.id).sort()).toEqual(['task:a', 'task:b']);
  });

  test('countByStatus totals match size()', () => {
    const g = new TaskGraph();
    g.addTask(make('a'));
    g.addTask(make('b', { status: 'ready' }));
    g.addTask(make('c', { status: 'running' }));
    const counts = g.countByStatus();
    expect(counts.backlog).toBe(1);
    expect(counts.ready).toBe(1);
    expect(counts.running).toBe(1);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(g.size());
  });
});

describe('TaskGraph — supersede', () => {
  test('supersede redirects dependents and marks old task', () => {
    const g = new TaskGraph();
    g.addTask(make('old'));
    g.addTask(make('new'));
    g.addTask(make('dep', { dependsOn: ['task:old'] }));
    g.supersede('task:old', ['task:new']);
    expect(g.getTask('task:old')?.status).toBe('superseded');
    expect(g.getTask('task:dep')?.dependsOn).toEqual(['task:new']);
  });

  test('supersede empty replacement removes dependency edge', () => {
    const g = new TaskGraph();
    g.addTask(make('old'));
    g.addTask(make('dep', { dependsOn: ['task:old'] }));
    g.supersede('task:old', []);
    expect(g.getTask('task:dep')?.dependsOn).toEqual([]);
  });

  test('supersede of already-done throws INVALID_TRANSITION', () => {
    const g = new TaskGraph();
    g.addTask(make('d', { status: 'done' }));
    expect(() => g.supersede('task:d', [])).toThrow(/INVALID_TRANSITION/);
  });

  test('supersede with missing replacement throws NOT_FOUND', () => {
    const g = new TaskGraph();
    g.addTask(make('o'));
    expect(() => g.supersede('task:o', ['task:ghost'])).toThrow(/NOT_FOUND/);
  });
});

describe('TaskGraph — snapshot', () => {
  test('snapshot captures tasks + countsByStatus', () => {
    const g = new TaskGraph();
    g.addTask(make('a'));
    g.addTask(make('b', { status: 'ready' }));
    const snap = g.snapshot();
    expect(snap.tasks).toHaveLength(2);
    expect(snap.countsByStatus.backlog).toBe(1);
    expect(snap.countsByStatus.ready).toBe(1);
  });
});
