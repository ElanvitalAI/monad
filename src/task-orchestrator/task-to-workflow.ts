// Surface-unification v2.2 V2.2-7 (2026-05-11) — TOX task → workflow-runtime
// bridge helper.
//
// Converts a TOX `Task` + `scheduleText` into a `WorkflowEntry` so the
// daemon's schedule source can fire the task as a workflow run.
// `bridgeTaskToScheduler` (legacy · `src/scheduler/jobs.ts`) is retired
// by this module — TOX no longer touches `src/scheduler/**`.
//
// Pure: no IO, no daemon call. Caller (`runtimes/create.ts`) looks up
// the workflow daemon via `runtime-deps.getWorkflowDaemon()` and invokes
// `daemon.registerWorkflow(entry)` with the result of `taskToWorkflowEntry`.
//
// scheduleText 형식 (cron · every-interval) 만 지원. one-shot ("30m" ·
// ISO timestamp) 는 ScheduleTriggerNode 의 `max_runs` 가 v1 author-facing
// only 이므로 본 PR scope 외 — V2.2-7 v2 (max_runs daemon enforce) 후속.

import type {
  DagNode,
  PromptNode,
  BashNode,
  SkillNode,
  ScheduleTriggerNode,
  WorkflowDefinition,
  WorkflowEntry,
} from '../workflow-runtime/types.js';
import type { Task, TaskSurface } from './types.js';

/** Result of `parseTaskScheduleText` — discriminated by `type`. */
export type TaskScheduleTrigger =
  | { type: 'cron'; cron: string }
  | { type: 'interval'; interval: number };

/** Recognized "every X<unit>" durations (m/h/d). Mirrors
 *  `src/scheduler/schedule.ts` so existing TOX scheduleText values stay
 *  compatible after the bridge swap. */
const DURATION_RE = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;

function durationMs(raw: string): number | null {
  const m = raw.trim().match(DURATION_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase()[0]!;
  const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

/** 5-field cron — same predicate as legacy scheduler. */
function isCronExpression(raw: string): boolean {
  const parts = raw.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\d*,/\-]+$/.test(p));
}

/** Parse a TOX `scheduleText` into a `ScheduleTriggerNode.scheduleTrigger`
 *  body. Throws when the text resolves to an "at" (one-shot) schedule —
 *  unsupported in V2.2-7 v1. */
export function parseTaskScheduleText(scheduleText: string): TaskScheduleTrigger {
  const raw = scheduleText.trim();
  if (!raw) throw new Error('scheduleText is required');

  if (isCronExpression(raw)) {
    return { type: 'cron', cron: raw };
  }

  const every = raw.match(/^every\s+(.+)$/i);
  if (every) {
    const ms = durationMs(every[1]!);
    if (!ms || ms <= 0) {
      throw new Error(`invalid interval schedule: ${raw}`);
    }
    return { type: 'interval', interval: ms };
  }

  // "30m" / ISO timestamp = one-shot. Unsupported in v1 because
  // `ScheduleTriggerNode.max_runs` is v1 author-facing only — the daemon
  // scheduler would re-fire forever. Surface a clear error so callers
  // can route one-shot tasks through a different path (immediate
  // dispatch · or wait for V2.2-7 v2).
  throw new Error(
    `scheduleText "${raw}" is a one-shot schedule (V2.2-7 v1 supports only ` +
    `cron 5-field and "every Xm/Xh" interval). Use a recurring schedule, or ` +
    `dispatch the task immediately without scheduleText.`,
  );
}

/** Extract a prompt string from a TOX surface — fallback for surfaces
 *  that do not have a natural workflow node analog (chat-prompt · vw-slot
 *  · acx-session · cron). Mirrors the legacy `schedulerPromptFromTask`
 *  shape so behavior carries over for tasks that previously ran through
 *  the legacy scheduler. */
export function promptFromTaskSurface(task: Task): string {
  switch (task.surface.kind) {
    case 'llm-direct':
      return task.surface.prompt;
    case 'skill':
      return [`Run skill: ${task.surface.skillName}`, task.description].filter(Boolean).join('\n');
    case 'subagent':
      return task.surface.prompt;
    case 'chat-prompt':
      return task.surface.question.question;
    case 'terminal-pane':
      return task.surface.spec.command || task.description || task.title;
    case 'cron':
      return task.description || task.title;
    case 'vw-slot':
      return task.description || task.title;
    case 'acx-session':
      return task.surface.prompt;
    case 'showroom':
      return [`Showroom: ${task.surface.title}`, ...task.surface.lanes.map((l) => `${l.role}:${l.model}`)].join(' · ');
    default:
      return task.description || task.title;
  }
}

/** Map a TOX `TaskSurface` to a single workflow body node. The node id
 *  is the literal `'body'` (caller wires `depends_on: ['trigger']`). */
export function surfaceToBodyNode(task: Task): DagNode {
  const surface: TaskSurface = task.surface;
  const base = { id: 'body', depends_on: ['trigger'] };
  switch (surface.kind) {
    case 'terminal-pane': {
      const bash = surface.spec.command?.trim();
      if (bash) return { ...base, bash } as BashNode;
      return { ...base, prompt: promptFromTaskSurface(task) } as PromptNode;
    }
    case 'skill': {
      const node: SkillNode = {
        ...base,
        skill: surface.skillName,
        ...(surface.args ? { arguments: JSON.stringify(surface.args) } : {}),
      };
      return node;
    }
    case 'llm-direct':
    case 'subagent':
    case 'acx-session':
    case 'chat-prompt':
    case 'cron':
    case 'vw-slot':
    case 'showroom':
    // self-implement / dev-harness tasks run via the dispatcher's adapter,
    // not this legacy workflow path — describe as a prompt node if ever routed here.
    case 'self-implement':
    case 'dev-harness':
      return { ...base, prompt: promptFromTaskSurface(task) } as PromptNode;
  }
}

/** A workflow name safe for `~/.monad/workflows-runs/<runId>/` paths.
 *  Mirrors the legacy `taskId` shape (already kebab-case · 32 hex). */
function workflowNameForTask(taskId: string): string {
  return `tox-task-${taskId}`;
}

/** Build the `WorkflowEntry` that the daemon's schedule source will
 *  subscribe. The entry is in-memory only — there is no on-disk YAML
 *  artifact (the daemon's discovery scan does not touch it). */
export function taskToWorkflowEntry(task: Task, scheduleText: string): WorkflowEntry {
  const trigger = parseTaskScheduleText(scheduleText);
  const triggerNode: ScheduleTriggerNode = {
    id: 'trigger',
    scheduleTrigger: trigger,
  };
  const bodyNode = surfaceToBodyNode(task);
  const definition: WorkflowDefinition = {
    name: workflowNameForTask(task.id),
    description: task.description || task.title,
    nodes: [triggerNode, bodyNode],
  };
  return {
    source: {
      source: 'global',
      path: `<tox:${task.id}>`,
    },
    definition,
  };
}
