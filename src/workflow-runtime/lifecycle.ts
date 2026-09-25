/**
 * M4-6 (2026-05-12) — workflow publish/draft lifecycle store.
 *
 * Layered on top of the existing workflow YAML discovery: lifecycle
 * state lives in a side-file (`<workflows-dir>/.lifecycle.json`) so
 * the schema-validated YAML stays untouched and back-compatible.
 * Existing workflows are treated as `active` until a setLifecycle()
 * call flips them.
 *
 * Why a side file rather than a YAML field:
 *   - Updating `active` ↔ `draft` 100 times shouldn't churn the
 *     workflow YAML's git history.
 *   - The schema validator is strict; threading the lifecycle field
 *     through every consumer + parser is far more invasive than the
 *     v1 read/write semantics need.
 *   - Side-file lookup is O(1) via the JSON map (single round-trip).
 *
 * Trigger gating ('draft' workflows skipped at fire time) is a
 * follow-up arc — this v1 ships the store + read/write endpoints so
 * intake auto-graph register_all can mark new workflows as `draft`
 * by default and the user explicitly publishes via PWA / CLI.
 *
 * Cross-ref:
 *   src/workflow-runtime/storage.ts (saveWorkflow disk writer)
 *   src/workflow-runtime/discovery.ts (workflow scope dirs)
 *   src/nexus/api/workflow-lifecycle.ts (HTTP endpoints)
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { getGlobalWorkflowDir } from './discovery.js';

// ──────────────────── Public surface ─────────────────────────────────

export type WorkflowLifecycleStatus = 'draft' | 'active';

export const WORKFLOW_LIFECYCLE_STATUSES: readonly WorkflowLifecycleStatus[] = [
  'draft',
  'active',
];

export function isWorkflowLifecycleStatus(
  v: unknown,
): v is WorkflowLifecycleStatus {
  return typeof v === 'string'
    && (WORKFLOW_LIFECYCLE_STATUSES as readonly string[]).includes(v);
}

/** On-disk JSON shape — version field so future schema additions
 *  don't break the reader. */
interface LifecycleFile {
  version: 1;
  /** workflowName → status. Missing entries imply 'active'. */
  status: Record<string, WorkflowLifecycleStatus>;
  /** ISO timestamp of the last mutation. */
  updatedAt: string;
}

const LIFECYCLE_FILE = '.lifecycle.json';

// ──────────────────── Path resolution + I/O ─────────────────────────

export interface LifecycleIoDeps {
  /** Test seam — override the dir that backs the JSON store. Defaults
   *  to the global workflows dir (`~/.monad/workflows/`). */
  resolveDir?: () => string;
  /** Test seam — overrides `readFileSync`. Defaults to fs. */
  readFile?: (path: string) => string;
  /** Test seam — overrides `writeFileSync`. Defaults to fs. */
  writeFile?: (path: string, content: string) => void;
  /** Test seam — for deterministic timestamps. */
  now?: () => number;
}

function lifecyclePath(deps: LifecycleIoDeps): string {
  const dir = deps.resolveDir ? deps.resolveDir() : getGlobalWorkflowDir();
  return join(dir, LIFECYCLE_FILE);
}

function readFile(path: string, deps: LifecycleIoDeps): LifecycleFile | null {
  try {
    const text = deps.readFile ? deps.readFile(path) : readFileSync(path, 'utf8');
    const parsed = JSON.parse(text) as LifecycleFile;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    if (!parsed.status || typeof parsed.status !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFile(
  path: string,
  data: LifecycleFile,
  deps: LifecycleIoDeps,
): void {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (deps.writeFile) {
    // Test seam — assume the caller's writer owns directory creation.
    deps.writeFile(path, text);
    return;
  }
  // Production path — ensure the workflow dir exists, then writeFile.
  const dir = deps.resolveDir ? deps.resolveDir() : getGlobalWorkflowDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, text, 'utf8');
}

// ──────────────────── Public ops ────────────────────────────────────

/** Read a single workflow's lifecycle status. Missing file or missing
 *  entry → 'active' (the back-compat default). */
export function readWorkflowLifecycle(
  workflowName: string,
  deps: LifecycleIoDeps = {},
): WorkflowLifecycleStatus {
  const file = readFile(lifecyclePath(deps), deps);
  if (!file) return 'active';
  return file.status[workflowName] ?? 'active';
}

/** Bulk read — returns the entire status map (workflowName → status).
 *  Useful for the PWA workflow list page (single fetch). */
export function listWorkflowLifecycle(
  deps: LifecycleIoDeps = {},
): Record<string, WorkflowLifecycleStatus> {
  const file = readFile(lifecyclePath(deps), deps);
  return file ? { ...file.status } : {};
}

export interface SetLifecycleResult {
  ok: boolean;
  status: WorkflowLifecycleStatus;
  /** ISO timestamp of the write. */
  updatedAt: string;
  /** Previous status (undefined = first write). */
  previous?: WorkflowLifecycleStatus;
}

/** Write a workflow's lifecycle status. Idempotent — writing the same
 *  status twice still updates `updatedAt` but otherwise no-ops. */
export function setWorkflowLifecycle(
  workflowName: string,
  status: WorkflowLifecycleStatus,
  deps: LifecycleIoDeps = {},
): SetLifecycleResult {
  if (!workflowName) {
    return { ok: false, status, updatedAt: new Date(0).toISOString() };
  }
  const now = deps.now ?? Date.now;
  const path = lifecyclePath(deps);
  const existing = readFile(path, deps);
  const previousFile: LifecycleFile = existing ?? {
    version: 1,
    status: {},
    updatedAt: new Date(0).toISOString(),
  };
  const previous = previousFile.status[workflowName];
  const next: LifecycleFile = {
    version: 1,
    status: { ...previousFile.status, [workflowName]: status },
    updatedAt: new Date(now()).toISOString(),
  };
  writeFile(path, next, deps);
  const result: SetLifecycleResult = {
    ok: true,
    status,
    updatedAt: next.updatedAt,
  };
  if (previous) result.previous = previous;
  return result;
}

/** Reset a workflow back to the default (delete the explicit entry).
 *  After this call, `readWorkflowLifecycle()` returns 'active'. */
export function clearWorkflowLifecycle(
  workflowName: string,
  deps: LifecycleIoDeps = {},
): boolean {
  const path = lifecyclePath(deps);
  const file = readFile(path, deps);
  if (!file || !(workflowName in file.status)) return false;
  const next = { ...file.status };
  delete next[workflowName];
  const now = deps.now ?? Date.now;
  writeFile(
    path,
    { version: 1, status: next, updatedAt: new Date(now()).toISOString() },
    deps,
  );
  return true;
}
