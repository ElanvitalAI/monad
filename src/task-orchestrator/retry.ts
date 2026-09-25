/**
 * RetryPolicy — exponential backoff retry for failed TOX tasks.
 *
 * Origin: 내부 문서 `PLAN-session-tox-resilience` · TOX-6.
 *
 * Design:
 *   - Subscribes to the event bus for `task-failed` events; when the
 *     4-AND retry condition holds, schedules a delayed
 *     `failed → ready` transition so the dispatcher picks the task
 *     back up on its next tick.
 *   - The dispatcher itself is unchanged — this module is a *policy*
 *     object; it can be swapped for a circuit-breaker variant without
 *     touching dispatch internals.
 *   - No bus emission by itself; the status transition flows through
 *     graph.updateTask which is already observable. A `[RETRY …]`
 *     note is appended for traceability.
 */
import type { TaskGraph } from './graph.js';
import type { TaskEvent, TaskEventBus, TaskEventDisposable } from './events.js';
import type { Task } from './types.js';

/** Error codes we never retry — they're programmer errors or
 *  explicit cancels, not transient infra failures. */
export const DEFAULT_NON_RETRYABLE_CODES: readonly string[] = [
  'ABORTED',
  'INVALID_TRANSITION',
  'VALIDATION_FAILED',
  'DEPTH_EXCEEDED',
  'PARSE_FAILED',
  'USER_CANCELLED',
];

export interface RetryPolicyOptions {
  graph: TaskGraph;
  bus?: TaskEventBus;
  /** Base delay in ms. Default 1000. */
  baseDelayMs?: number;
  /** Multiplier applied at each attempt. Default 4 (1s → 4s → 16s). */
  factor?: number;
  /** Upper bound so catastrophic base*factor^N doesn't overflow. */
  maxDelayMs?: number;
  /** Force-override per-task maxRetries. Default undefined → respect
   *  task.maxRetries. */
  maxAttemptsOverride?: number;
  /** Custom non-retryable list. Default DEFAULT_NON_RETRYABLE_CODES. */
  nonRetryableCodes?: readonly string[];
  /** Test seam — schedule a callback. Returns a cancel function.
   *  Default uses setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  /** Telemetry sink. */
  log?: (line: string) => void;
}

export type SkipReason =
  | 'attempt-exhausted'
  | 'non-retryable'
  | 'aborted'
  | 'not-failed'
  | 'not-found'
  | 'already-scheduled';

export class RetryPolicy {
  private readonly baseDelayMs: number;
  private readonly factor: number;
  private readonly maxDelayMs: number;
  private readonly maxAttemptsOverride: number | undefined;
  private readonly nonRetryableCodes: readonly string[];
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;

  private subscription: TaskEventDisposable | null = null;
  private readonly pending = new Map<string, () => void>();

  constructor(private readonly opts: RetryPolicyOptions) {
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.factor = opts.factor ?? 4;
    this.maxDelayMs = opts.maxDelayMs ?? 5 * 60 * 1000; // 5 min
    this.maxAttemptsOverride = opts.maxAttemptsOverride;
    this.nonRetryableCodes = opts.nonRetryableCodes ?? DEFAULT_NON_RETRYABLE_CODES;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.subscription) return;
    const bus = this.opts.bus;
    if (!bus) return;
    this.subscription = bus.subscribe(
      (ev: TaskEvent) => {
        if (ev.kind !== 'task-failed') return;
        this.tryScheduleRetry(ev.taskId, ev.errorCode);
      },
      { kinds: ['task-failed'] },
    );
  }

  stop(): void {
    this.subscription?.dispose();
    this.subscription = null;
    // Cancel all pending timers — no further retries after stop.
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Evaluate retry condition + schedule if eligible.
   * Returns a status string — 'scheduled' on commit, otherwise the
   * specific skip reason. Exposed for tests.
   */
  tryScheduleRetry(
    taskId: string,
    errorCode?: string,
  ): 'scheduled' | `skipped:${SkipReason}` {
    const task = this.opts.graph.getTask(taskId);
    if (!task) return 'skipped:not-found';
    if (task.status !== 'failed') return 'skipped:not-failed';
    if (errorCode === 'ABORTED') return 'skipped:aborted';
    if (errorCode && this.nonRetryableCodes.includes(errorCode)) {
      return 'skipped:non-retryable';
    }
    const limit = this.maxAttemptsOverride ?? task.maxRetries;
    if (task.attempt >= limit) return 'skipped:attempt-exhausted';
    if (this.pending.has(taskId)) return 'skipped:already-scheduled';

    const delay = this.computeDelay(task.attempt);
    const cancel = this.schedule(() => {
      this.pending.delete(taskId);
      this.executeRetry(taskId, delay);
    }, delay);
    this.pending.set(taskId, cancel);
    const scheduledAt = this.now();
    this.opts.bus?.emit({
      kind: 'task-retry-scheduled',
      taskId,
      attempt: task.attempt + 1,
      delayMs: delay,
      scheduledFor: scheduledAt + delay,
    });
    this.opts.log?.(
      `[retry] scheduled ${taskId} attempt=${task.attempt + 1} in ${delay}ms`,
    );
    return 'scheduled';
  }

  private executeRetry(taskId: string, delayMs: number): void {
    const task = this.opts.graph.getTask(taskId);
    if (!task) return;
    if (task.status !== 'failed') return; // raced: already cancelled/superseded
    const nextAttempt = task.attempt + 1;
    const note = `[RETRY attempt=${nextAttempt} base=${delayMs}ms]`;
    try {
      this.opts.graph.updateTask(
        taskId,
        {
          status: 'ready',
          attempt: nextAttempt,
          notes: [...task.notes, note],
        },
        { now: this.now() },
      );
      this.opts.log?.(`[retry] ${taskId} → ready (attempt ${nextAttempt})`);
    } catch (err) {
      this.opts.log?.(
        `[retry] ${taskId} transition refused: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private computeDelay(currentAttempt: number): number {
    const raw = this.baseDelayMs * this.factor ** currentAttempt;
    return Math.min(Math.floor(raw), this.maxDelayMs);
  }
}

// ─────────────────────────── default schedule ─────────────────────

function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}
