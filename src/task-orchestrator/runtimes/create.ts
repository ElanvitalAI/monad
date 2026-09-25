/**
 * TaskCreate runtime — adds a single task to the graph.
 */
import type { LLMToolSpec } from '../../llm.js';
import type { ToolRuntime } from '../../tool-runtime/types.js';
import {
  createTask,
  isTaskSurface,
  type Task,
  type TaskSurface,
  type TaskPriority,
  type TaskIsolation,
} from '../types.js';
import { getToxRuntimeDeps } from '../runtime-deps.js';
import { taskToWorkflowEntry } from '../task-to-workflow.js';
import type { WorkflowRuntimeDaemon } from '../../workflow-runtime/daemon.js';

export interface TaskCreateInput {
  title: string;
  description?: string;
  surface: unknown;
  goalSlug?: string;
  dependsOn?: string[];
  priority?: TaskPriority;
  isolation?: TaskIsolation;
  estimateMs?: number;
  estimateTokens?: number;
  estimateUsd?: number;
  scheduleText?: string;
}

export interface TaskCreateResult {
  output: string;
  taskId?: string;
  task?: Task;
}

export async function dispatchTaskCreate(
  input: TaskCreateInput,
): Promise<TaskCreateResult> {
  const graph = getToxRuntimeDeps().getGraph();
  if (!graph) return { output: 'TOX not initialized — graph unavailable' };
  if (!input.title || input.title.trim().length === 0) {
    return { output: 'TaskCreate: title is required' };
  }
  if (!isTaskSurface(input.surface)) {
    return { output: 'TaskCreate: surface must be a valid TaskSurface tagged union' };
  }

  const task = createTask({
    title: input.title,
    description: input.description,
    surface: input.surface as TaskSurface,
    goalSlug: input.goalSlug,
    dependsOn: input.dependsOn,
    priority: input.priority,
    isolation: input.isolation,
    estimateMs: input.estimateMs,
    estimateTokens: input.estimateTokens,
    estimateUsd: input.estimateUsd,
    scheduleText: input.scheduleText?.trim() || undefined,
    status: input.scheduleText?.trim() ? 'scheduled' : undefined,
    generatedBy: { kind: 'user' },
  });
  let scheduleDeferred: string | null = null;
  try {
    graph.addTask(task);
    if (task.scheduleText) {
      // V2.2-7 (2026-05-11) — TOX→workflow-runtime direct wire. The
      // legacy `scheduler-bridge.ts` + `src/scheduler/jobs.ts` path was
      // retired; the daemon's schedule source now owns recurring TOX
      // tasks. When the daemon is not wired yet (standalone TOX · CLI
      // before NEXUS boots) we still create the task and persist the
      // scheduleText so a follow-up registration can pick it up — the
      // user just sees a "(deferred)" hint in the output. The same
      // graceful path covers helper-rejected shapes (V2.2-7 v1 throws
      // on one-shot durations and ISO timestamps).
      // Deterministic workflow name even when registration is deferred,
      // so the task's `schedulerJobId` is set up-front and a future
      // backfill (NEXUS boot · V2.2-7 v2 one-shot support) can find +
      // register the entry without renaming.
      const pendingWorkflowName = `tox-task-${task.id}`;
      graph.updateTask(task.id, { schedulerJobId: pendingWorkflowName });

      const daemon = getToxRuntimeDeps().getWorkflowDaemon?.() as WorkflowRuntimeDaemon | null;
      if (daemon) {
        try {
          const entry = taskToWorkflowEntry(task, task.scheduleText);
          daemon.registerWorkflow(entry);
        } catch (err) {
          // V2.2-7 v1 scope rejection (one-shot · ISO timestamp) — task
          // stays scheduled with scheduleText preserved so a future
          // V2.2-7 v2 backfill can register it without losing intent.
          scheduleDeferred = err instanceof Error ? err.message : String(err);
        }
      } else {
        scheduleDeferred = 'workflow-runtime daemon not yet wired';
      }
    }
  } catch (err) {
    return {
      output: `TaskCreate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!task.scheduleText) graph.promoteReady();
  const scheduleSuffix = task.scheduleText
    ? ` · scheduled via ${task.scheduleText}${scheduleDeferred ? ' (deferred — ' + scheduleDeferred + ')' : ''}`
    : '';
  return {
    output: `TaskCreate: ${task.id} "${task.title}" [${task.surface.kind}] added${scheduleSuffix}`,
    taskId: task.id,
    task: graph.getTask(task.id),
  };
}

export function buildTaskCreateTool(): LLMToolSpec {
  return {
    name: 'TaskCreate',
    description:
      'Create a single TOX task and add it to the orchestrator graph. Use when you need ' +
      'to queue work directly (without LLM decomposition). For complex objectives use ' +
      'TaskDecompose + TaskDecomposeApply.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Imperative title, ≤80 chars.' },
        description: { type: 'string' },
        surface: {
          type: 'object',
          description:
            'TaskSurface tagged union (kind + kind-specific fields). See TaskSurfaceKind.',
        },
        goalSlug: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        isolation: { type: 'string', enum: ['shared', 'worktree'] },
        estimateMs: { type: 'number' },
        estimateTokens: { type: 'number' },
        estimateUsd: { type: 'number' },
        scheduleText: { type: 'string' },
      },
      required: ['title', 'surface'],
      additionalProperties: false,
    },
  };
}

export const taskCreateRuntime: ToolRuntime<TaskCreateInput, TaskCreateResult> = {
  id: 'task_create',
  spec: buildTaskCreateTool(),
  async run(req) {
    return dispatchTaskCreate(req);
  },
};
