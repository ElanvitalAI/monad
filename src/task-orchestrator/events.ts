/**
 * Task Orchestrator events bus.
 *
 * Origin: `내부 문서 `PLAN-session-task-orchestrator-coevolution`` §3 +
 * Phase 3 (feat/tox-foundation-events).
 *
 * Responsibilities:
 *   - Canonical `TaskEvent` discriminated union — all meaningful
 *     state changes in the orchestrator flow through this.
 *   - In-memory ring buffer (default 500) for dashboard tails + tests.
 *   - Pub/sub with per-kind filter + `dispose` cleanup.
 *   - Persistent append-only sink (`events.jsonl`) is **out of scope**
 *     for this phase — the bus exposes a generic `onEmit` so a future
 *     store module can subscribe and write lines.
 *
 * Purity: The bus itself holds state (ring + subscribers). Publishers
 * (graph / dispatcher / scheduler / generator) remain decoupled — they
 * `emit(event)` and never read listeners.
 *
 * Phase 2 (graph.ts) is **not** modified. A thin adapter in a later
 * phase will wire graph mutations to emissions. Graph stays pure.
 */
import type { TaskStatus, TaskSurfaceKind } from './types.js';

// ───────────────────────── Event union ──────────────────────────────

/**
 * Every mutation the orchestrator emits. New kinds require:
 *  1. Add variant to `TaskEvent`
 *  2. Include in `TASK_EVENT_KINDS` below (used by subscribe filters
 *     + devtools)
 *  3. If it represents a status transition, also update graph policy.
 *
 * All events carry `timestamp` (epoch ms) + `taskId` for single-task
 * indexing. Cross-task events (graph-snapshot, etc.) set `taskId =
 * null` — keeps downstream filters simple.
 */
export type TaskEvent =
  | {
      kind: 'task-created';
      timestamp: number;
      taskId: string;
      surface: TaskSurfaceKind;
      goalSlug?: string;
      parentId?: string;
      generatedBy?: 'user' | 'llm' | 'cron' | 'followUp' | 'regenerate';
    }
  | {
      kind: 'task-status-changed';
      timestamp: number;
      taskId: string;
      from: TaskStatus;
      to: TaskStatus;
      reason?: string;
    }
  | {
      kind: 'task-scheduled';
      timestamp: number;
      taskId: string;
      surface: TaskSurfaceKind;
    }
  | {
      kind: 'task-started';
      timestamp: number;
      taskId: string;
      executionId: string;
      surfaceAddress?: string;
      modelId?: string;
    }
  | {
      kind: 'task-completed';
      timestamp: number;
      taskId: string;
      executionId: string;
      durationMs?: number;
      costUsd?: number;
    }
  | {
      kind: 'task-failed';
      timestamp: number;
      taskId: string;
      executionId: string;
      errorCode: string;
      errorMessage: string;
      willRetry: boolean;
      attempt: number;
    }
  | {
      kind: 'task-cancelled';
      timestamp: number;
      taskId: string;
      reason: 'user' | 'cascade' | 'budget' | 'timeout' | 'escalation';
    }
  | {
      kind: 'task-regenerated';
      timestamp: number;
      taskId: string | null;    // null when re-decomposing from goal root
      goalSlug?: string;
      replacementIds: string[];
      depth: number;
    }
  | {
      kind: 'task-superseded';
      timestamp: number;
      taskId: string;
      replacementIds: string[];
    }
  | {
      kind: 'budget-warning';
      timestamp: number;
      taskId: string | null;
      goalSlug?: string;
      axis: 'tokens' | 'usd' | 'wallclock' | 'weekly';
      remainingPct: number;
    }
  | {
      kind: 'escalation';
      timestamp: number;
      taskId: string | null;
      severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
      reason: string;
    }
  | {
      kind: 'task-retry-scheduled';
      timestamp: number;
      taskId: string;
      /** Attempt number this retry will advance to (current.attempt + 1). */
      attempt: number;
      /** Delay from schedule time until the retry fires. */
      delayMs: number;
      /** Absolute epoch ms when the retry is scheduled to run. */
      scheduledFor: number;
    };

export type TaskEventKind = TaskEvent['kind'];

/**
 * Input to `emit()` — each discriminated variant may carry its own
 * fields. Using distributive conditional so `Omit<TaskEvent, 'timestamp'>`
 * preserves the union structure (the naïve `Omit` flattens it).
 */
export type TaskEventEmitInput = TaskEvent extends infer E
  ? E extends TaskEvent
    ? Omit<E, 'timestamp'> & { timestamp?: number }
    : never
  : never;

export const TASK_EVENT_KINDS: readonly TaskEventKind[] = [
  'task-created',
  'task-status-changed',
  'task-scheduled',
  'task-started',
  'task-completed',
  'task-failed',
  'task-cancelled',
  'task-regenerated',
  'task-superseded',
  'budget-warning',
  'escalation',
  'task-retry-scheduled',
] as const;

export function isTaskEventKind(v: unknown): v is TaskEventKind {
  return typeof v === 'string' && (TASK_EVENT_KINDS as readonly string[]).includes(v);
}

// ───────────────────────── Subscriber shape ────────────────────────

export type TaskEventListener = (event: TaskEvent) => void;

export interface TaskEventSubscribeOptions {
  /** Filter by one or more kinds. Omit to receive everything. */
  kinds?: readonly TaskEventKind[];
  /** Filter by taskId (exact match). */
  taskId?: string;
  /** Filter by goalSlug — matches events with matching `goalSlug`
   *  field. Events missing the field are skipped.  */
  goalSlug?: string;
}

export interface EventBusOptions {
  /** Ring buffer capacity. Older events drop when full. Default 500.
   *  Setting to 0 disables retention (subscribers still fire). */
  capacity?: number;
}

/** Disposable handle returned by subscribe. */
export type TaskEventDisposable = { dispose: () => void };

// ───────────────────────── Bus ─────────────────────────────────────

export class TaskEventBus {
  private readonly buf: TaskEvent[] = [];
  private readonly cap: number;
  private readonly listeners = new Set<{
    fn: TaskEventListener;
    opts: TaskEventSubscribeOptions;
  }>();

  constructor(opts: EventBusOptions = {}) {
    this.cap = opts.capacity ?? 500;
    if (!Number.isInteger(this.cap) || this.cap < 0) {
      throw new RangeError('EventBusOptions.capacity must be a non-negative integer');
    }
  }

  /** Emit an event. Stamps `timestamp` if the caller omitted it. */
  emit(ev: TaskEventEmitInput): TaskEvent {
    const withTs = { ...ev, timestamp: ev.timestamp ?? Date.now() } as TaskEvent;
    if (this.cap > 0) {
      this.buf.push(withTs);
      while (this.buf.length > this.cap) this.buf.shift();
    }
    for (const sub of this.listeners) {
      if (!matches(withTs, sub.opts)) continue;
      try {
        sub.fn(withTs);
      } catch {
        // Isolate listener errors — a throwing subscriber must not
        // break the pipeline. Devs can add a global error listener
        // later if needed.
      }
    }
    return withTs;
  }

  /** Subscribe. Returns a disposable — call `.dispose()` to stop. */
  subscribe(fn: TaskEventListener, opts: TaskEventSubscribeOptions = {}): TaskEventDisposable {
    const sub = { fn, opts };
    this.listeners.add(sub);
    return { dispose: () => this.listeners.delete(sub) };
  }

  /**
   * Read the most-recent slice from the ring buffer. `limit` caps
   * the output; `sinceTs` returns only events stamped after that
   * epoch ms. Filters mirror `subscribe` semantics.
   */
  tail(
    opts: TaskEventSubscribeOptions & { limit?: number; sinceTs?: number } = {}
  ): TaskEvent[] {
    const limit = opts.limit ?? 100;
    const since = opts.sinceTs;
    const out: TaskEvent[] = [];
    // walk newest to oldest for bounded cost
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const ev = this.buf[i]!;
      if (since !== undefined && ev.timestamp < since) break;
      if (!matches(ev, opts)) continue;
      out.push(ev);
      if (out.length >= limit) break;
    }
    return out.reverse(); // oldest-first is more readable
  }

  /** Current buffer size (≤ capacity). */
  size(): number {
    return this.buf.length;
  }

  /** Clear ring buffer. Does not drop subscribers. */
  clear(): void {
    this.buf.length = 0;
  }

  /** Listener count — useful for leak tests. */
  listenerCount(): number {
    return this.listeners.size;
  }
}

// ───────────────────────── Module-level singleton ─────────────────

let _bus: TaskEventBus | null = null;

/**
 * Shared bus. Dispatcher / graph-adapter / generator publish here;
 * dashboard / loop-prompt subscribe. Lazy init — zero-cost until
 * first touch (keeps import-time side effects minimal).
 */
export function getTaskEventBus(): TaskEventBus {
  if (!_bus) _bus = new TaskEventBus();
  return _bus;
}

/** Test helper — swap the singleton (or reset). */
export function __setTaskEventBusForTest(b: TaskEventBus | null): void {
  _bus = b;
}

// ───────────────────────── Internals ──────────────────────────────

function matches(ev: TaskEvent, opts: TaskEventSubscribeOptions): boolean {
  if (opts.kinds && !opts.kinds.includes(ev.kind)) return false;
  if (opts.taskId !== undefined) {
    if (ev.taskId !== opts.taskId) return false;
  }
  if (opts.goalSlug !== undefined) {
    const slug = (ev as { goalSlug?: string }).goalSlug;
    if (slug !== opts.goalSlug) return false;
  }
  return true;
}
