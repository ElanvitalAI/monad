// Scheduler-retirement R4 (2026-05-11) — workflow-runs listing helper.
//
// Reads `~/.elanous/workflows-runs/<runId>/run.json` and returns a
// minimal row shape suitable for the scheduler-task-list widget
// (R4 dashboard widget redirect). Pure I/O — no caching, no
// global state. Callers that need a long-lived projection should
// memoize themselves.
//
// Companion to `scheduler/store.listJobs()` for the R4/R5 migration
// window: dashboard reads through this helper instead of the
// scheduler store so `src/scheduler/**` can be archived in R5
// without touching the widget surface.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { join } from 'path';

export interface WorkflowRunRow {
  /** runId — synthetic id from the directory name. */
  runId: string;
  /** Workflow definition name (from run.json). */
  workflowName: string;
  /** Run lifecycle status. Maps to scheduler `status` for widget
   *  compatibility: 'running' → 'active' · 'ok' → 'completed' ·
   *  'failed' → 'failed' · 'pending' → 'draft'. */
  status: 'pending' | 'running' | 'ok' | 'failed';
  /** Optional started-at ISO. */
  startedAt?: string;
  /** Optional completed-at ISO. */
  completedAt?: string;
  /** Optional error message when status='failed'. */
  error?: string;
}

export interface ListRunsOpts {
  /** Override the dir (tests). Defaults to `~/.elanous/workflows-runs/`. */
  dir?: string;
  /** Max rows to return (most recent first). Defaults to 200. */
  limit?: number;
}

export function defaultWorkflowRunsDir(): string {
  return join(elanousStateRoot(), 'workflows-runs');
}

/** Pure-ish: lists `dir/<runId>/run.json` rows. Skips entries that
 *  are unreadable or missing fields. Most recent first by mtime. */
export function listWorkflowRuns(opts: ListRunsOpts = {}): WorkflowRunRow[] {
  const dir = opts.dir ?? defaultWorkflowRunsDir();
  const limit = opts.limit ?? 200;
  if (!existsSync(dir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  type Indexed = { row: WorkflowRunRow; mtime: number };
  const rows: Indexed[] = [];
  for (const name of entries) {
    const runDir = join(dir, name);
    const runJson = join(runDir, 'run.json');
    if (!existsSync(runJson)) continue;
    try {
      const stat = statSync(runJson);
      const raw = readFileSync(runJson, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const workflowName = typeof parsed.workflowName === 'string'
        ? parsed.workflowName
        : '(unknown)';
      const status = normalizeStatus(parsed);
      const row: WorkflowRunRow = {
        runId: name,
        workflowName,
        status,
      };
      if (typeof parsed.startedAt === 'number') {
        row.startedAt = new Date(parsed.startedAt).toISOString();
      } else if (typeof parsed.startedAt === 'string') {
        row.startedAt = parsed.startedAt;
      }
      if (typeof parsed.completedAt === 'number') {
        row.completedAt = new Date(parsed.completedAt).toISOString();
      } else if (typeof parsed.completedAt === 'string') {
        row.completedAt = parsed.completedAt;
      }
      if (typeof parsed.error === 'string') {
        row.error = parsed.error;
      }
      rows.push({ row, mtime: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.slice(0, limit).map(r => r.row);
}

function normalizeStatus(parsed: Record<string, unknown>): WorkflowRunRow['status'] {
  if (parsed.completedAt !== undefined) {
    return parsed.ok === false || typeof parsed.error === 'string' ? 'failed' : 'ok';
  }
  if (parsed.startedAt !== undefined) return 'running';
  return 'pending';
}
