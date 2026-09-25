// 병렬 실행 라인 오케스트레이터 (2026-07-22) — dev-harness 잡을 TOX 위에서 동시성캡 병렬.
//
// self-dev(orchestrate.ts)의 형제 — 코드 self-build 대신 **실행 라인**(harness run·--domain web/invest)을
// 병렬화한다. 엔진(TaskGraph/TaskDispatcher/EventBus)은 그대로 재사용(재발명0). 각 잡=독립 worktree
// 서브프로세스(dev-harness 어댑터·자기 harness-space)라 hot-file 직렬화 불요(전부 독립 병렬).
// self-implement 특화 기능(resume/decompose/board/disposition)은 제외 — 실행 라인은 단발 병렬로 충분.

import { TaskGraph } from '../task-orchestrator/graph.js';
import { TaskDispatcher } from '../task-orchestrator/dispatcher.js';
import { TaskEventBus, type TaskEvent } from '../task-orchestrator/events.js';
import { SurfaceRegistry } from '../task-orchestrator/surface-registry.js';
import { createTask, TASK_DEFAULTS, OPEN_TASK_STATUSES, type TaskStatus } from '../task-orchestrator/types.js';
import { createDevHarnessAdapter, defaultDevHarnessSpawn, spaceIdForDevHarnessTask, type DevHarnessJobSpawn } from '../task-orchestrator/surfaces/dev-harness.js';
import { debug } from '../debug/log.js';

/** 한 실행 잡 — objective + 선택 도메인/타깃/자율도. */
export interface HarnessJob {
  objective: string;
  /** 'web'|'publish'|'invest'|'research'|'digest' · 생략=코드. */
  domain?: string;
  /** 'self'(기본) 또는 절대경로. */
  target?: string;
  /** 'off'|'safe'|'on'. */
  autoDrive?: string;
  /** ★ G9 P2 — auto-review 라벨 부착 인텐트(병렬 실행 라인도 L3 무인 리뷰 진입·단발 harness run 대칭). */
  autoReview?: boolean;
}

export interface HarnessJobResult {
  taskId: string;
  objective: string;
  domain?: string;
  status: TaskStatus;
  error?: string;
  space?: string;
}

export interface OrchestrateHarnessOptions {
  jobs: HarnessJob[];
  /** 동시 실행 잡 수(기본 dev-harness 캡=4). */
  concurrency?: number;
  /** 테스트 seam — fake spawn(부작용 0). */
  spawn?: DevHarnessJobSpawn;
  now?: () => number;
  onEvent?: (ev: TaskEvent) => void;
}

/**
 * dev-harness 잡 N개를 TOX 디스패처 위에서 동시성캡 병렬 실행. 각 잡=자기 프로세스=자기 harness-space.
 * 독립 병렬(의존성 없음). 전 잡 종결 시 결과 배열 resolve.
 */
export function orchestrateHarness(opts: OrchestrateHarnessOptions): Promise<HarnessJobResult[]> {
  const now = opts.now ?? Date.now;
  const graph = new TaskGraph();
  const bus = new TaskEventBus();
  const registry = new SurfaceRegistry();

  const spawn = opts.spawn ?? defaultDevHarnessSpawn();
  registry.register('dev-harness', createDevHarnessAdapter({ spawn, now }));
  const dispatcher = new TaskDispatcher({
    graph, registry, bus, now,
    ...(opts.concurrency !== undefined ? { concurrencyCaps: { 'dev-harness': opts.concurrency } } : {}),
  });

  const jobByTask = new Map<string, HarnessJob>();
  const spaceByTask = new Map<string, string>();
  opts.jobs.forEach((job) => {
    const task = createTask(
      {
        title: (job.domain ? `[${job.domain}] ` : '') + job.objective.slice(0, 60),
        description: job.objective.slice(0, TASK_DEFAULTS.descriptionMaxLen),
        surface: {
          kind: 'dev-harness',
          objective: job.objective,
          ...(job.domain !== undefined ? { domain: job.domain } : {}),
          ...(job.target !== undefined ? { target: job.target } : {}),
          ...(job.autoDrive !== undefined ? { autoDrive: job.autoDrive } : {}),
          ...(job.autoReview !== undefined ? { autoReview: job.autoReview } : {}),
        },
        isolation: 'worktree',
      },
      { now: now() },
    );
    graph.addTask(task);
    jobByTask.set(task.id, job);
    spaceByTask.set(task.id, spaceIdForDevHarnessTask(task));
  });

  debug.log('self-dev.orchestrate-harness', 'start', {
    jobs: opts.jobs.length,
    concurrency: opts.concurrency ?? 'default(4)',
    domains: [...new Set(opts.jobs.map((j) => j.domain ?? 'code'))],
  });

  return new Promise<HarnessJobResult[]>((resolve) => {
    const results = new Map<string, HarnessJobResult>();
    let settled = false;

    const buildResults = (): HarnessJobResult[] => {
      const out: HarnessJobResult[] = [];
      for (const [taskId, job] of jobByTask) {
        const status = graph.getTask(taskId)?.status ?? 'failed';
        out.push(results.get(taskId) ?? {
          taskId, objective: job.objective, ...(job.domain ? { domain: job.domain } : {}),
          status, space: spaceByTask.get(taskId),
        });
      }
      return out;
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      const out = buildResults();
      const done = out.filter((r) => r.status === 'done').length;
      const failed = out.filter((r) => r.status === 'failed').length;
      const cancelled = out.filter((r) => r.status === 'cancelled').length;
      debug.log('self-dev.orchestrate-harness', 'done', { total: out.length, completed: done, failed, cancelled });
      resolve(out);
    };

    const openCount = (): number => {
      const c = graph.countByStatus();
      return (OPEN_TASK_STATUSES as readonly TaskStatus[]).reduce((n, s) => n + c[s], 0);
    };

    const scheduleTick = (): void => {
      queueMicrotask(() => {
        if (settled) return;
        graph.promoteReady({ now: now() });
        const { dispatched } = dispatcher.tick();
        if (openCount() === 0) { finish(); return; }
        // Stuck guard: open tasks but nothing running/dispatched → no capacity ever frees.
        if (dispatched.length === 0 && graph.listRunning().length === 0) finish();
      });
    };

    bus.subscribe((ev) => {
      try { opts.onEvent?.(ev); } catch { /* isolate */ }
      const shortObj = (id: string): string => (jobByTask.get(id)?.objective ?? '').slice(0, 60);
      switch (ev.kind) {
        case 'task-started':
          debug.log('self-dev.orchestrate-harness', 'job.start', { taskId: ev.taskId, space: spaceByTask.get(ev.taskId), objective: shortObj(ev.taskId) });
          break;
        case 'task-completed': {
          const job = jobByTask.get(ev.taskId);
          if (job) results.set(ev.taskId, { taskId: ev.taskId, objective: job.objective, ...(job.domain ? { domain: job.domain } : {}), status: 'done', space: spaceByTask.get(ev.taskId) });
          debug.log('self-dev.orchestrate-harness', 'job.done', { taskId: ev.taskId, objective: shortObj(ev.taskId) });
          scheduleTick();
          break;
        }
        case 'task-failed': {
          const job = jobByTask.get(ev.taskId);
          if (job) results.set(ev.taskId, { taskId: ev.taskId, objective: job.objective, ...(job.domain ? { domain: job.domain } : {}), status: 'failed', error: ev.errorMessage, space: spaceByTask.get(ev.taskId) });
          debug.log('self-dev.orchestrate-harness', 'job.fail', { taskId: ev.taskId, error: ev.errorMessage?.slice(0, 100) }, { level: 'error' });
          scheduleTick();
          break;
        }
        default:
          break;
      }
    });

    if (opts.jobs.length === 0) { finish(); return; }
    scheduleTick();
  });
}
