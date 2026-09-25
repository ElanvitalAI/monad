/**
 * Goal-level aggregator for TOX.
 *
 * Origin: 내부 문서 `PLAN-session-tox-goal-summary`.
 *
 * Pure function that walks the graph's goal index and produces a
 * compact, widget-agnostic summary — task counts by status, progress
 * ratio, USD estimates, next ready task, and age of the oldest still-
 * open task. Consumers include loop-prompt section (future FU), board
 * sidebar badges, and `/task stats` slash output.
 */
import type { TaskGraph } from './graph.js';
import type {
  Task,
  TaskStatus,
  TaskSurfaceKind,
  TaskPriority,
} from './types.js';
import { surfaceGlyph } from './types.js';

// ───────────────────────── Types ────────────────────────────────

export interface GoalSummaryStoreHook {
  /** Sum of costUsd across all executions tied to the goal. */
  listExecutionsForGoal?: (slug: string) => Array<{ costUsd?: number }>;
}

export interface SummarizeGoalOptions {
  now?: number;
  store?: GoalSummaryStoreHook;
}

export interface NextReadyInfo {
  id: string;
  title: string;
  surface: TaskSurfaceKind;
  priority: TaskPriority;
}

export interface GoalSummary {
  goalSlug: string;
  counts: Record<TaskStatus, number>;
  /** Total tasks (excluding cancelled + superseded). */
  total: number;
  /** done / total — 0 when total=0. */
  progress: number;
  estimateUsdTotal: number;
  actualUsdTotal: number;
  nextReady: NextReadyInfo | null;
  lastActivity: number | null;
  ageOldestOpenMs: number | null;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ───────────────────────── Public entry ─────────────────────────

export function summarizeGoal(
  graph: TaskGraph,
  goalSlug: string,
  opts: SummarizeGoalOptions = {},
): GoalSummary {
  const now = opts.now ?? Date.now();
  const tasks = graph.listByGoal(goalSlug);

  const counts: Record<TaskStatus, number> = {
    backlog: 0,
    blocked: 0,
    scheduled: 0,
    ready: 0,
    running: 0,
    review: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    superseded: 0,
  };
  let total = 0;
  let estimateUsdTotal = 0;
  let lastActivity: number | null = null;
  let ageOldestOpenMs: number | null = null;
  let nextReady: Task | null = null;

  for (const t of tasks) {
    counts[t.status]++;
    if (t.status !== 'cancelled' && t.status !== 'superseded') {
      total++;
      if (typeof t.estimateUsd === 'number' && Number.isFinite(t.estimateUsd)) {
        estimateUsdTotal += t.estimateUsd;
      }
      if (lastActivity === null || t.updatedAt > lastActivity) {
        lastActivity = t.updatedAt;
      }
      if (isOpen(t.status)) {
        const age = Math.max(0, now - t.createdAt);
        if (ageOldestOpenMs === null || age > ageOldestOpenMs) {
          ageOldestOpenMs = age;
        }
      }
      if (t.status === 'ready') {
        nextReady = pickHigherPriority(nextReady, t);
      }
    }
  }

  const doneCount = counts.done;
  const progress = total === 0 ? 0 : doneCount / total;

  const actualUsdTotal = opts.store?.listExecutionsForGoal
    ? sumExecUsd(opts.store.listExecutionsForGoal(goalSlug))
    : 0;

  return {
    goalSlug,
    counts,
    total,
    progress,
    estimateUsdTotal,
    actualUsdTotal,
    nextReady: nextReady
      ? {
          id: nextReady.id,
          title: nextReady.title,
          surface: nextReady.surface.kind,
          priority: nextReady.priority,
        }
      : null,
    lastActivity,
    ageOldestOpenMs,
  };
}

// ───────────────────────── Format helpers ────────────────────────

export function formatGoalSummaryLine(summary: GoalSummary): string {
  const pct = Math.round(summary.progress * 100);
  const cost = summary.actualUsdTotal > 0 || summary.estimateUsdTotal > 0
    ? ` · $${summary.actualUsdTotal.toFixed(2)}/$${summary.estimateUsdTotal.toFixed(2)}`
    : '';
  const next = summary.nextReady
    ? ` · next: ${summary.nextReady.title}`
    : ' · next: (none)';
  return `${summary.goalSlug} ▸ ${summary.counts.done}/${summary.total} done (${pct}%)${cost}${next}`;
}

export function formatGoalSummaryMarkdown(summary: GoalSummary): string {
  const lines: string[] = [];
  lines.push(`## Goal: ${summary.goalSlug}`);
  lines.push('');
  const pct = Math.round(summary.progress * 100);
  lines.push(`- progress: ${summary.counts.done}/${summary.total} (${pct}%)`);
  lines.push(
    `- counts: backlog ${summary.counts.backlog} · blocked ${summary.counts.blocked}` +
      ` · ready ${summary.counts.ready} · running ${summary.counts.running}` +
      ` · review ${summary.counts.review} · done ${summary.counts.done}` +
      ` · failed ${summary.counts.failed}`,
  );
  if (summary.estimateUsdTotal > 0 || summary.actualUsdTotal > 0) {
    lines.push(
      `- cost: $${summary.actualUsdTotal.toFixed(2)} actual / $${summary.estimateUsdTotal.toFixed(2)} estimate`,
    );
  }
  if (summary.nextReady) {
    const n = summary.nextReady;
    lines.push(
      `- next-ready: ${surfaceGlyph(n.surface)} ${n.id} "${n.title}" [${n.priority}]`,
    );
  } else {
    lines.push('- next-ready: (none)');
  }
  if (summary.ageOldestOpenMs !== null) {
    lines.push(`- oldest open: ${formatAge(summary.ageOldestOpenMs)}`);
  }
  return lines.join('\n');
}

// ───────────────────────── internals ─────────────────────────────

function isOpen(status: TaskStatus): boolean {
  return (
    status === 'backlog' ||
    status === 'blocked' ||
    status === 'scheduled' ||
    status === 'ready' ||
    status === 'running' ||
    status === 'review'
  );
}

function pickHigherPriority(a: Task | null, b: Task): Task {
  if (!a) return b;
  const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
  const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
  if (pb < pa) return b;
  if (pb > pa) return a;
  // same priority → older (smaller createdAt) wins
  return b.createdAt < a.createdAt ? b : a;
}

function sumExecUsd(execs: Array<{ costUsd?: number }>): number {
  let s = 0;
  for (const e of execs) {
    if (typeof e.costUsd === 'number' && Number.isFinite(e.costUsd)) s += e.costUsd;
  }
  return s;
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
