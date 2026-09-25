// Y2 compute scheduler · 2-slot local + budget-aware cloud + idle-only queue.
// Cf. ROADMAP-background-reasoning §5.3 schedule(task) + §5.5 file tree.
// Substrate for Y3 Patcher (slot-0 = patcher · always-on idle) and Y4
// Thinker (slot-1 = thinker · spawn on KGS threshold). Compose this with
// `UserActivityMonitor.onChange` to pause/resume on user activity.

import type { BudgetAwareRouter, RouteResult } from './budget-aware-router.js';
import type { BackgroundReasoningConfig } from './config.js';
import {
  LocalLLMPool,
  type LocalLLMTask,
  type LocalSlotAssignment,
  type SlotRole,
} from './local-llm-process.js';
import type { UserActivityMonitor, ActivitySnapshot } from './user-activity-monitor.js';

export interface BackgroundTask<TIn = unknown, TOut = unknown> {
  id: string;
  role: SlotRole;
  input: TIn;
  /** Runs the LLM on a local slot. Receives slot's bound model+baseUrl. */
  runLocal: (input: TIn, a: LocalSlotAssignment) => Promise<TOut>;
  /** Runs against a cloud provider when local is saturated. */
  runCloud?: (input: TIn) => Promise<TOut>;
  /** Bypasses budget guard when truthy + emergencyCloudAlways=true. */
  emergency?: boolean;
}

export type TaskOutcome<TOut> =
  | { status: 'local'; result: TOut; slotId: string; route: RouteResult }
  | { status: 'cloud'; result: TOut; route: RouteResult }
  | { status: 'queued'; route: RouteResult }
  | { status: 'rejected'; reason: string; route?: RouteResult };

export interface ComputeSchedulerOpts {
  config: BackgroundReasoningConfig;
  pool: LocalLLMPool;
  router: BudgetAwareRouter;
  monitor?: UserActivityMonitor;
  /** Per-role default slot assignment. Caller wires nodeId+modelId+baseUrl
   *  from local-manager.resolveBaseUrl. */
  defaultAssignment: (role: SlotRole) => LocalSlotAssignment | null;
}

interface QueuedItem<TOut> {
  task: BackgroundTask<unknown, TOut>;
  resolve: (out: TaskOutcome<TOut>) => void;
}

export class ComputeScheduler {
  private readonly cfg: BackgroundReasoningConfig;
  private readonly pool: LocalLLMPool;
  private readonly router: BudgetAwareRouter;
  private readonly assign: (role: SlotRole) => LocalSlotAssignment | null;
  private readonly queue: QueuedItem<unknown>[] = [];
  private readonly off?: () => void;
  private paused = false;

  constructor(opts: ComputeSchedulerOpts) {
    this.cfg = opts.config;
    this.pool = opts.pool;
    this.router = opts.router;
    this.assign = opts.defaultAssignment;
    if (opts.monitor) {
      this.off = opts.monitor.onChange((s) => this.onActivityChange(s));
    }
  }

  /** Wire local-manager into this factory so callers stay decoupled. */
  static makePool(size: number): LocalLLMPool {
    return new LocalLLMPool({ size });
  }

  pendingCount(): number {
    return this.queue.length;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async schedule<TIn, TOut>(task: BackgroundTask<TIn, TOut>): Promise<TaskOutcome<TOut>> {
    if (this.paused) {
      return this.enqueue(task);
    }

    const slot = this.pool.findFree() ?? this.pool.findByRole(task.role);
    const localAvailable = slot !== null && slot.status() !== 'busy' && slot.status() !== 'paused';
    const route = this.router.route({
      role: task.role,
      localAvailable,
      ...(task.emergency ? { emergency: true } : {}),
    });

    if (route.decision === 'local' && slot) {
      return this.runOnSlot(slot, task, route);
    }
    if (route.decision === 'cloud') {
      if (!task.runCloud) {
        return { status: 'rejected', reason: 'cloud-route-but-no-runCloud', route };
      }
      const result = await task.runCloud(task.input);
      return { status: 'cloud', result, route };
    }
    return this.enqueue(task);
  }

  private async runOnSlot<TIn, TOut>(
    slot: ReturnType<LocalLLMPool['findFree']> & object,
    task: BackgroundTask<TIn, TOut>,
    route: RouteResult,
  ): Promise<TaskOutcome<TOut>> {
    if (slot.status() === 'free') {
      const a = this.assign(task.role);
      if (!a) {
        return { status: 'rejected', reason: `no-default-assignment-for-${task.role}`, route };
      }
      slot.assign(a);
    }
    const inner: LocalLLMTask<TIn, TOut> = {
      role: task.role,
      input: task.input,
      run: task.runLocal,
    };
    const result = await slot.run(inner);
    void this.drain();
    return { status: 'local', result, slotId: slot.slotId(), route };
  }

  private enqueue<TIn, TOut>(task: BackgroundTask<TIn, TOut>): Promise<TaskOutcome<TOut>> {
    return new Promise((resolve) => {
      this.queue.push({
        task: task as BackgroundTask<unknown, unknown>,
        resolve: resolve as (out: TaskOutcome<unknown>) => void,
      });
    });
  }

  private async drain(): Promise<void> {
    if (this.paused) return;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      const slot = this.pool.findFree() ?? this.pool.findByRole(item.task.role);
      if (!slot || slot.status() === 'busy' || slot.status() === 'paused') {
        this.queue.unshift(item);
        return;
      }
      const route = this.router.route({ role: item.task.role, localAvailable: true });
      if (route.decision !== 'local') {
        this.queue.unshift(item);
        return;
      }
      const outcome = await this.runOnSlot(slot, item.task, route);
      item.resolve(outcome);
    }
  }

  private onActivityChange(snap: ActivitySnapshot): void {
    if (snap.state === 'active' && snap.load >= this.cfg.userActiveCpuThreshold) {
      this.paused = true;
      this.pool.pauseAll();
    } else if (snap.state === 'idle') {
      this.paused = false;
      this.pool.resumeAll();
      void this.drain();
    }
  }

  dispose(): void {
    if (this.off) this.off();
  }
}
