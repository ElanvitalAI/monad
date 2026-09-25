/**
 * Late-bound dependency slot for TOX tool runtimes.
 *
 * Tool-runtime registration happens at module-eval time (imported from
 * `src/tool-runtime/index.ts` before the dashboard wires graph /
 * dispatcher / generator). To keep registration order independent of
 * the TOX boot order, runtimes look up their deps through getter
 * functions stored here — they may legitimately return `null` until
 * `setToxRuntimeDeps()` is called by the dashboard bootstrap.
 */
import type { TaskGraph } from './graph.js';
import type { TaskDispatcher } from './dispatcher.js';
import type { TaskGenerator } from './generator.js';

// Forward-declared to avoid circular imports.
type TaskStoreRef = unknown;
type TaskFeedbackLoopRef = unknown;
// V2.2-7 (2026-05-11) — kept structural so the orchestrator does not
// import `src/workflow-runtime/daemon.ts` at type-check time (NEXUS is
// the one wiring the real daemon via `setToxRuntimeDeps`). The runtime
// caller (`scheduler-bridge` / `runtimes/create.ts`) treats this as a
// `WorkflowRuntimeDaemon | null` after the cast.
type WorkflowRuntimeDaemonRef = unknown;

export interface ToxRuntimeDeps {
  getGraph: () => TaskGraph | null;
  getDispatcher: () => TaskDispatcher | null;
  getGenerator: () => TaskGenerator | null;
  getStore?: () => TaskStoreRef | null;
  getFeedbackLoop?: () => TaskFeedbackLoopRef | null;
  /** V2.2-7 (2026-05-11) — workflow-runtime daemon getter wired by
   *  NEXUS (`src/nexus/index.ts`). Used by `task-orchestrator/runtimes/
   *  create.ts` to register a TOX task as a workflow entry the daemon
   *  schedule source will fire. `null` when running outside NEXUS
   *  (CLI · standalone tests · TOX boot pre-NEXUS sequencing) so the
   *  bridge can throw a clear error instead of NPE. */
  getWorkflowDaemon?: () => WorkflowRuntimeDaemonRef | null;
}

const NULL_DEPS: ToxRuntimeDeps = {
  getGraph: () => null,
  getDispatcher: () => null,
  getGenerator: () => null,
  getStore: () => null,
  getFeedbackLoop: () => null,
  getWorkflowDaemon: () => null,
};

let CURRENT: ToxRuntimeDeps = NULL_DEPS;

export function setToxRuntimeDeps(deps: ToxRuntimeDeps): void {
  CURRENT = {
    ...NULL_DEPS,
    ...deps,
  };
}

export function getToxRuntimeDeps(): ToxRuntimeDeps {
  return CURRENT;
}

export function resetToxRuntimeDepsForTest(): void {
  CURRENT = NULL_DEPS;
}

/** Session-scoped pending decompose table — applyToken → result.
 *  Lives in module scope; cleared on reset. A full store would persist
 *  via TaskStore (TOX-1d) — intentionally kept in-memory for MVP. */
const pendingDecompose = new Map<
  string,
  { result: unknown; goalSlug?: string; objective: string; createdAt: number }
>();

export const DECOMPOSE_PENDING_TTL_MS = 30 * 60 * 1000; // 30 min

export function storePendingDecompose(
  token: string,
  entry: { result: unknown; goalSlug?: string; objective: string },
): void {
  pendingDecompose.set(token, { ...entry, createdAt: Date.now() });
}

export function takePendingDecompose(
  token: string,
): { result: unknown; goalSlug?: string; objective: string } | null {
  const entry = pendingDecompose.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > DECOMPOSE_PENDING_TTL_MS) {
    pendingDecompose.delete(token);
    return null;
  }
  pendingDecompose.delete(token);
  return entry;
}

export function clearPendingDecomposeForTest(): void {
  pendingDecompose.clear();
}
