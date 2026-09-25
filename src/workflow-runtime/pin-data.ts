/**
 * M4-4 (2026-05-12) — workflow node pin data store.
 *
 * Maps `{workflowName, nodeId} → fake output value` so the executor
 * can replay a deterministic answer for LLM / HTTP / bash nodes
 * during debugging. The actual executor seam (skip-real-call when a
 * pin is present) is a follow-up (M4-4.2); this v1 ships the store
 * + read/write endpoints so the PWA workflow editor can record pins
 * + the user can manage them out-of-band.
 *
 * Side-file storage: `<workflows-dir>/<workflowName>.pins.json` —
 * one file per workflow so the JSON stays small + git-diffable. The
 * lifecycle store sits in a single `.lifecycle.json` because the
 * status field is tiny; pin payloads (LLM responses · HTTP bodies)
 * can be hundreds of bytes each, so per-workflow files keep churn
 * scoped.
 *
 * Cross-ref:
 *   src/workflow-runtime/lifecycle.ts (M4-6 sibling — same side-file
 *     idiom but global rather than per-workflow)
 *   src/nexus/api/workflow-pins.ts (HTTP endpoints)
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { getGlobalWorkflowDir } from './discovery.js';

// ──────────────────── Types ─────────────────────────────────────────

/** Whatever the executor would return as a node's output. We store
 *  it as a JSON-serialisable union (string is the common case for
 *  LLM responses · object for structured returns · number for
 *  classify scores · ...). */
export type PinValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: PinValue }
  | PinValue[];

export interface WorkflowPinEntry {
  nodeId: string;
  value: PinValue;
  /** ISO timestamp of the last write — surfaces "stale pin" in UI. */
  updatedAt: string;
  /** Free-form annotation (why was this pinned, where did the
   *  fake value come from). Optional. */
  note?: string;
}

interface PinFile {
  version: 1;
  workflow: string;
  /** nodeId → entry. */
  pins: Record<string, WorkflowPinEntry>;
}

// ──────────────────── Path resolution + I/O ─────────────────────────

export interface PinIoDeps {
  resolveDir?: () => string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  unlinkFile?: (path: string) => void;
  now?: () => number;
}

function safeWorkflowName(name: string): string | null {
  // Match the same character set saveWorkflow accepts; reject path
  // separators / dots so the pin file can't escape the workflows dir.
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$/.test(name)) return null;
  if (name.includes('..')) return null;
  return name;
}

function pinPath(workflowName: string, deps: PinIoDeps): string | null {
  const safe = safeWorkflowName(workflowName);
  if (!safe) return null;
  const dir = deps.resolveDir ? deps.resolveDir() : getGlobalWorkflowDir();
  return join(dir, `${safe}.pins.json`);
}

function readFile(path: string, deps: PinIoDeps): PinFile | null {
  try {
    const text = deps.readFile ? deps.readFile(path) : readFileSync(path, 'utf8');
    const parsed = JSON.parse(text) as PinFile;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    if (!parsed.pins || typeof parsed.pins !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFile(path: string, data: PinFile, deps: PinIoDeps): void {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (deps.writeFile) {
    deps.writeFile(path, text);
    return;
  }
  const dir = deps.resolveDir ? deps.resolveDir() : getGlobalWorkflowDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function unlinkPath(path: string, deps: PinIoDeps): void {
  if (deps.unlinkFile) { deps.unlinkFile(path); return; }
  try { unlinkSync(path); } catch { /* ignore — best-effort */ }
}

// ──────────────────── Public ops ────────────────────────────────────

/** Read all pins for a workflow. Returns empty record when the file
 *  doesn't exist or the workflow name is invalid. */
export function listWorkflowPins(
  workflowName: string,
  deps: PinIoDeps = {},
): Record<string, WorkflowPinEntry> {
  const path = pinPath(workflowName, deps);
  if (!path) return {};
  const file = readFile(path, deps);
  return file ? { ...file.pins } : {};
}

/** Read one pin for a workflow node. Returns null when the file
 *  doesn't exist, the workflow name is invalid, or no pin is set
 *  for the requested node. Hot path — called from the workflow
 *  executor's dispatchNode (M4-4.2 seam · FU8 PR #1). */
export function readWorkflowPin(
  workflowName: string,
  nodeId: string,
  deps: PinIoDeps = {},
): WorkflowPinEntry | null {
  const path = pinPath(workflowName, deps);
  if (!path) return null;
  const file = readFile(path, deps);
  if (!file) return null;
  return file.pins[nodeId] ?? null;
}

export interface SetPinResult {
  ok: boolean;
  workflow: string;
  nodeId: string;
  entry?: WorkflowPinEntry;
  /** Set when the workflow name failed validation. */
  error?: string;
}

/** Write a single pin entry. Idempotent — repeated writes still
 *  refresh `updatedAt`. */
export function setWorkflowPin(
  workflowName: string,
  nodeId: string,
  value: PinValue,
  opts: { note?: string } = {},
  deps: PinIoDeps = {},
): SetPinResult {
  const path = pinPath(workflowName, deps);
  if (!path) {
    return { ok: false, workflow: workflowName, nodeId, error: 'invalid_workflow_name' };
  }
  if (!nodeId) {
    return { ok: false, workflow: workflowName, nodeId, error: 'missing_node_id' };
  }
  const now = deps.now ?? Date.now;
  const existing = readFile(path, deps);
  const baseline: PinFile = existing ?? {
    version: 1,
    workflow: workflowName,
    pins: {},
  };
  const entry: WorkflowPinEntry = {
    nodeId,
    value,
    updatedAt: new Date(now()).toISOString(),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
  const next: PinFile = {
    version: 1,
    workflow: workflowName,
    pins: { ...baseline.pins, [nodeId]: entry },
  };
  writeFile(path, next, deps);
  return { ok: true, workflow: workflowName, nodeId, entry };
}

/** Remove one pin (or every pin when nodeId is undefined). Returns
 *  the count of entries removed. */
export function clearWorkflowPins(
  workflowName: string,
  nodeId: string | undefined,
  deps: PinIoDeps = {},
): number {
  const path = pinPath(workflowName, deps);
  if (!path) return 0;
  const file = readFile(path, deps);
  if (!file) return 0;
  if (nodeId === undefined) {
    // Wipe every pin for the workflow → unlink the file.
    const removed = Object.keys(file.pins).length;
    unlinkPath(path, deps);
    return removed;
  }
  if (!(nodeId in file.pins)) return 0;
  const next = { ...file.pins };
  delete next[nodeId];
  if (Object.keys(next).length === 0) {
    unlinkPath(path, deps);
    return 1;
  }
  writeFile(path, { version: 1, workflow: workflowName, pins: next }, deps);
  return 1;
}
