import { describe, expect, test } from 'bun:test';
import {
  TASK_STATUSES,
  OPEN_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  TASK_SURFACE_KINDS,
  TASK_DEFAULTS,
  createTask,
  createExecution,
  newTaskId,
  newExecutionId,
  isTaskId,
  isExecutionId,
  isTaskStatus,
  isOpenStatus,
  isTerminalStatus,
  isTaskSurface,
  isTaskSurfaceKind,
  isTaskDeterministicCheck,
  surfaceGlyph,
  serializeTask,
  type TaskSurface,
  type TaskDeterministicCheck,
} from '../src/task-orchestrator/types.js';

describe('TaskStatus', () => {
  test('10 canonical statuses exist', () => {
    expect(TASK_STATUSES).toHaveLength(10);
  });

  test('open + terminal are disjoint and cover every status', () => {
    const open = new Set(OPEN_TASK_STATUSES);
    const term = new Set(TERMINAL_TASK_STATUSES);
    for (const s of TASK_STATUSES) {
      const inOpen = open.has(s);
      const inTerm = term.has(s);
      // each status must be exactly in one bucket
      expect(inOpen !== inTerm).toBe(true);
    }
  });

  test('isTaskStatus accepts canonical + rejects garbage', () => {
    expect(isTaskStatus('ready')).toBe(true);
    expect(isTaskStatus('done')).toBe(true);
    expect(isTaskStatus('not-a-status')).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
    expect(isTaskStatus(42)).toBe(false);
  });

  test('isOpenStatus/isTerminalStatus match buckets', () => {
    expect(isOpenStatus('backlog')).toBe(true);
    expect(isOpenStatus('done')).toBe(false);
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('superseded')).toBe(true);
    expect(isTerminalStatus('backlog')).toBe(false);
  });
});

describe('TaskSurface tagged union', () => {
  test('11 surface kinds (7 TOX + AXON P6 acx-session + Z3 showroom + 하니스 흡수 2)', () => {
    // FU8 PR #6 (2026-05-12) — was 8 pre-Z3 (#2407 added the 9th
    // `'showroom'` kind for multi-model cascade tasks). The count
    // assert is kept as a load-bearing regression guard so adding a
    // 10th surface kind forces the author to update this test +
    // walk the call sites that switch on `TaskSurfaceKind`.
    //
    // 📏 2026-08-28 — 하니스 흡수가 `self-implement`·`dev-harness` 를 더해 9 → 11.
    //   ⭐ 이 가드는 «일했다». 그것이 시킨 「호출 자리 걷기」를 실제로 걸었고 결과는 이렇다:
    //   ⓐ src/task-orchestrator/surfaces/index.ts — case «없음»이 맞다. 그러나 결손이 아니다:
    //      두 어댑터는 실재하고(surfaces/self-implement.ts · surfaces/dev-harness.ts)
    //      ***self-dev 오케스트레이터가 자기 레지스트리에 등록한다***
    //        src/self-dev/orchestrate.ts:962      createSelfImplementAdapter(...)
    //        src/self-dev/orchestrate-harness.ts:59 registry.register('dev-harness', ...)
    //      ⇒ index.ts 는 «범용» 조립기이고 이 둘은 소유자가 따로다. 옮기려면 그 소유를 옮기는 판이다.
    //   ⓑ src/task-orchestrator/board/layout.ts — ⛔ 여기는 `TaskStatus` 로 분기한다(SurfaceKind 아님).
    //      「case 수」로 세면 관련 있어 보이지만 «다른 축»이다.
    //   ⓒ apps/pwa/src/components/tasks/TaskManagerPanel.tsx `surfaceToHookKind`
    //      — 자체 9종 유니온을 갖고 새 둘은 `default: return null`("let the lane decide")로 간다.
    //      🔵 ***미완이다*** — 넓히려면 그 훅이 두 종류를 받아야 하므로 PWA 축의 판이다(여기서 안 고친다).
    //   ⛔ 12번째를 더하는 사람은 위 세 자리를 «다시» 걷고 이 주석에 한 줄씩 더한다.
    expect(TASK_SURFACE_KINDS).toHaveLength(11);
    expect(TASK_SURFACE_KINDS).toContain('terminal-pane');
    expect(TASK_SURFACE_KINDS).toContain('subagent');
    expect(TASK_SURFACE_KINDS).toContain('skill');
    expect(TASK_SURFACE_KINDS).toContain('chat-prompt');
    expect(TASK_SURFACE_KINDS).toContain('llm-direct');
    expect(TASK_SURFACE_KINDS).toContain('cron');
    expect(TASK_SURFACE_KINDS).toContain('vw-slot');
    expect(TASK_SURFACE_KINDS).toContain('acx-session');
    expect(TASK_SURFACE_KINDS).toContain('showroom');
  });

  test('isTaskSurface validates each variant', () => {
    const valid: TaskSurface[] = [
      { kind: 'terminal-pane', spec: { command: 'bun test' } },
      { kind: 'vw-slot', windowId: 'win:1', slotId: 'slot:a' },
      { kind: 'subagent', definitionName: 'Explore', prompt: 'find X' },
      { kind: 'skill', skillName: 'omni-crawl' },
      { kind: 'chat-prompt', question: { header: 'h', question: 'q?', options: [] } },
      { kind: 'cron', scheduleText: 'every 2h' },
      { kind: 'llm-direct', prompt: 'summarise' },
    ];
    for (const s of valid) expect(isTaskSurface(s)).toBe(true);
  });

  test('isTaskSurface rejects malformed', () => {
    expect(isTaskSurface(null)).toBe(false);
    expect(isTaskSurface({})).toBe(false);
    expect(isTaskSurface({ kind: 'unknown' })).toBe(false);
    expect(isTaskSurface({ kind: 'terminal-pane' })).toBe(false); // missing spec
    expect(isTaskSurface({ kind: 'subagent', definitionName: 'X' })).toBe(false); // missing prompt
    expect(isTaskSurface({ kind: 'skill', skillName: '' })).toBe(false); // empty name
  });

  test('isTaskSurfaceKind round-trips', () => {
    for (const k of TASK_SURFACE_KINDS) expect(isTaskSurfaceKind(k)).toBe(true);
    expect(isTaskSurfaceKind('garbage')).toBe(false);
  });

  test('surfaceGlyph returns a single-character for each kind', () => {
    for (const k of TASK_SURFACE_KINDS) {
      const g = surfaceGlyph(k);
      expect(typeof g).toBe('string');
      expect(g.length).toBeGreaterThan(0);
    }
  });
});

describe('isTaskDeterministicCheck', () => {
  const cases: Array<[TaskDeterministicCheck, boolean]> = [
    [{ kind: 'exit-code', expected: 0 }, true],
    [{ kind: 'file-exists', path: '/tmp/x' }, true],
    [{ kind: 'file-contains', path: 'out.log', pattern: 'OK' }, true],
    [{ kind: 'output-matches', pattern: 'done' }, true],
    [{ kind: 'shell-zero', command: 'git diff --quiet' }, true],
    [{ kind: 'shell-zero', command: 'test -f x', timeoutMs: 1000 }, true],
  ];

  for (const [check, ok] of cases) {
    test(`accepts ${check.kind}`, () => {
      expect(isTaskDeterministicCheck(check)).toBe(ok);
    });
  }

  test('rejects malformed shapes', () => {
    expect(isTaskDeterministicCheck(null)).toBe(false);
    expect(isTaskDeterministicCheck({ kind: 'exit-code' })).toBe(false);
    expect(isTaskDeterministicCheck({ kind: 'exit-code', expected: 'zero' })).toBe(false);
    expect(isTaskDeterministicCheck({ kind: 'file-exists', path: '' })).toBe(false);
    expect(isTaskDeterministicCheck({ kind: 'output-matches' })).toBe(false);
  });
});

describe('id factories + guards', () => {
  test('newTaskId returns unique task:<hex>', () => {
    const a = newTaskId();
    const b = newTaskId();
    expect(a).not.toBe(b);
    expect(isTaskId(a)).toBe(true);
    expect(isTaskId(b)).toBe(true);
  });

  test('newExecutionId returns unique exec:<hex>', () => {
    const a = newExecutionId();
    const b = newExecutionId();
    expect(a).not.toBe(b);
    expect(isExecutionId(a)).toBe(true);
    expect(isExecutionId(b)).toBe(true);
  });

  test('guards reject cross-prefix + garbage', () => {
    expect(isTaskId('exec:abc123')).toBe(false);
    expect(isExecutionId('task:abc123')).toBe(false);
    expect(isTaskId('task:ZZZZ')).toBe(false); // non-hex
    expect(isTaskId(42)).toBe(false);
  });
});

describe('createTask factory', () => {
  const minimalSurface: TaskSurface = { kind: 'llm-direct', prompt: 'hello' };

  test('builds with defaults — status/priority/isolation/maxRetries/notes/version', () => {
    const t = createTask({ title: 'say hi', surface: minimalSurface });
    expect(t.id).toMatch(/^task:[0-9a-f]+$/);
    expect(t.status).toBe('backlog');
    expect(t.priority).toBe('medium');
    expect(t.isolation).toBe('shared');
    expect(t.maxRetries).toBe(TASK_DEFAULTS.maxRetries);
    expect(t.attempt).toBe(0);
    expect(t.version).toBe(1);
    expect(t.notes).toEqual([]);
    expect(t.dependsOn).toEqual([]);
    expect(t.triggerChain).toEqual([]);
    expect(t.scheduleText).toBeUndefined();
    expect(t.schedulerJobId).toBeUndefined();
    expect(t.createdAt).toBe(t.updatedAt);
  });

  test('honours explicit overrides', () => {
    const t = createTask(
      {
        title: 'urgent review',
        surface: minimalSurface,
        priority: 'urgent',
        isolation: 'worktree',
        maxRetries: 5,
        dependsOn: ['task:aaaa'],
        goalSlug: 'samsung-2026',
        generatedBy: { kind: 'llm', modelId: 'claude-opus-4-7', turn: 3 },
        triggerChain: ['task:aaaa', 'task:bbbb'],
        scheduleText: 'tomorrow 9am',
        schedulerJobId: 'task_sched_1',
      },
      { now: 1_700_000_000_000, id: 'task:deadbe', allowUncheckedUrgent: true }
    );
    expect(t.id).toBe('task:deadbe');
    expect(t.priority).toBe('urgent');
    expect(t.isolation).toBe('worktree');
    expect(t.maxRetries).toBe(5);
    expect(t.dependsOn).toEqual(['task:aaaa']);
    expect(t.goalSlug).toBe('samsung-2026');
    expect(t.createdAt).toBe(1_700_000_000_000);
    expect(t.triggerChain).toHaveLength(2);
    expect(t.scheduleText).toBe('tomorrow 9am');
    expect(t.schedulerJobId).toBe('task_sched_1');
  });

  test('frozen arrays — immutability guard', () => {
    const t = createTask({
      title: 'x',
      surface: minimalSurface,
      dependsOn: ['task:aaa'],
      triggerChain: ['task:aaa'],
    });
    // Object.freeze throws on strict; in loose mode it's silent no-op.
    expect(Object.isFrozen(t.dependsOn)).toBe(true);
    expect(Object.isFrozen(t.triggerChain)).toBe(true);
  });

  test('throws RangeError on empty title', () => {
    expect(() => createTask({ title: '', surface: minimalSurface })).toThrow(RangeError);
  });

  test('throws RangeError on title > 80 chars', () => {
    const long = 'x'.repeat(81);
    expect(() => createTask({ title: long, surface: minimalSurface })).toThrow(RangeError);
  });

  test('throws RangeError on negative maxRetries', () => {
    expect(() =>
      createTask({ title: 't', surface: minimalSurface, maxRetries: -1 })
    ).toThrow(RangeError);
  });

  test('throws RangeError on triggerChain > 5 hops', () => {
    const chain = ['task:a', 'task:b', 'task:c', 'task:d', 'task:e', 'task:f'];
    expect(() =>
      createTask({ title: 't', surface: minimalSurface, triggerChain: chain })
    ).toThrow(RangeError);
  });

  test('accepts triggerChain exactly at 5-hop cap', () => {
    const chain = ['task:a', 'task:b', 'task:c', 'task:d', 'task:e'];
    const t = createTask({ title: 't', surface: minimalSurface, triggerChain: chain });
    expect(t.triggerChain).toHaveLength(5);
  });

  test('rejects invalid surface tagged union', () => {
    expect(() =>
      createTask({ title: 't', surface: { kind: 'bogus' } as unknown as TaskSurface })
    ).toThrow(RangeError);
  });
});

describe('createExecution factory', () => {
  test('builds running execution bound to task', () => {
    const t = createTask({ title: 'x', surface: { kind: 'llm-direct', prompt: 'p' } });
    const e = createExecution(t, { now: 1_700_000_000_000, modelId: 'claude-haiku-4-5' });
    expect(e.id).toMatch(/^exec:[0-9a-f]+$/);
    expect(e.taskId).toBe(t.id);
    expect(e.startedAt).toBe(1_700_000_000_000);
    expect(e.status).toBe('running');
    expect(e.modelId).toBe('claude-haiku-4-5');
    expect(e.surface).toEqual(t.surface);
  });
});

describe('serializeTask', () => {
  test('projects to JSON-safe object with array copies', () => {
    const t = createTask({
      title: 'serialize me',
      surface: { kind: 'skill', skillName: 'diagram-master' },
      dependsOn: ['task:dep1', 'task:dep2'],
      triggerChain: ['task:parent'],
    });
    t.notes.push('[ATTEMPT 1] ran');
    const raw = serializeTask(t);
    // JSON round-trip sanity
    const revived = JSON.parse(JSON.stringify(raw));
    expect(revived.id).toBe(t.id);
    expect(revived.dependsOn).toEqual(['task:dep1', 'task:dep2']);
    expect(revived.triggerChain).toEqual(['task:parent']);
    expect(revived.notes).toEqual(['[ATTEMPT 1] ran']);
    expect(revived.scheduleText).toBeUndefined();
    expect(revived.schedulerJobId).toBeUndefined();
    // serialized arrays are independent copies — mutations don't leak
    revived.dependsOn.push('task:hack');
    expect(t.dependsOn).toHaveLength(2);
  });
});
