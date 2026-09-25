/**
 * `ResourceScheduler` — Phase 2 D4 / RESEARCH §6.
 *
 * Time-slices local-LLM-bound tasks across a pool of declared models +
 * decides whether an API fallback is OK against the current slot's
 * dispatchPolicy. The OpportunisticLauncher (D5) calls
 * `reserve(taskId, requirement)` before launching; the matching model
 * (or API approval) is held until `release(taskId)`.
 *
 * Pool entries are user-declared (E5: default 1 model declaration).
 * Each model carries a `maxConcurrent` ceiling — when full, the task
 * sits in a per-capability queue and waits for the next release.
 *
 * API gates follow the slot's `apiCost` axis (DispatchPolicy):
 *   - 'allow'  → request still passes; caller dispatches via API
 *   - 'prefer' → API preferred over local (rarely set in practice)
 *   - 'deny'   → only local is OK; if no local model matches → reject
 *
 * No actual LLM IO here — this module owns the *bookkeeping*. Callers
 * pair each reservation with the matching streamLLM* invocation.
 */
import type { DispatchPolicy, ResolvedSlot } from './time-slot.js';

// ──────────────────── Public shapes ────────────────────────────────────

export type LlmCapability =
  | 'coding'
  | 'reasoning'
  | 'chat'
  | 'summarize'
  | 'classify'
  | 'vision'
  | 'tools';

export interface LocalLlmDecl {
  id: string;                         // 'qwen-coder-72b'
  location: string;                   // 'lmstudio' · 'ollama' · 'mlx' · etc
  maxConcurrent: number;              // ceiling per model
  capabilities: readonly LlmCapability[];
  estimatedTokensPerSec?: number;
  /** Optional cost weight per token used in queue prioritisation. */
  costWeight?: number;
}

export interface TaskResourceRequirement {
  taskId: string;
  /** At least one capability the matching model must cover. */
  capabilities: readonly LlmCapability[];
  /** Optional explicit model id — if set, only that model satisfies. */
  preferredModelId?: string;
  /** Estimated tokens — informational, used by D5 / D7 only. */
  estimatedTokens?: number;
  /** True when the task is OK with API fallback. */
  apiFallbackAllowed?: boolean;
}

export type ReservationOutcome =
  | { ok: true; kind: 'local'; modelId: string }
  | { ok: true; kind: 'api'; reason: string }
  | { ok: false; reason: 'no-match' | 'all-busy' | 'api-denied' };

export interface SchedulerInspect {
  modelInUse: Record<string, number>;
  queuedTasks: number;
  reservationsByTask: Record<string, string>;   // taskId → modelId | 'api'
}

export interface ResourceSchedulerOptions {
  pool?: LocalLlmDecl[];
  /** Resolve current slot — provided by D1 TimeSlotManager.
   *  When omitted, a permissive default is used. */
  slot?: () => ResolvedSlot;
}

// ──────────────────── Scheduler ────────────────────────────────────────

interface QueuedJob {
  requirement: TaskResourceRequirement;
  resolve: (out: ReservationOutcome) => void;
}

export class ResourceScheduler {
  private readonly pool: LocalLlmDecl[];
  private readonly slot: () => ResolvedSlot;
  private readonly inUse = new Map<string, number>();           // modelId → count
  private readonly assignment = new Map<string, string>();      // taskId → modelId | 'api'
  private readonly queue: QueuedJob[] = [];

  constructor(opts: ResourceSchedulerOptions = {}) {
    this.pool = opts.pool ?? [];
    this.slot = opts.slot ?? defaultSlot;
  }

  // ──────────────── Pool introspection ──────────────────────────

  listPool(): readonly LocalLlmDecl[] {
    return this.pool;
  }

  inspect(): SchedulerInspect {
    return {
      modelInUse: Object.fromEntries(this.inUse),
      queuedTasks: this.queue.length,
      reservationsByTask: Object.fromEntries(this.assignment),
    };
  }

  // ──────────────── Reserve / release ───────────────────────────

  /**
   * Try to reserve a model right now. Returns ok=false when:
   *   - no model in the pool matches the requirement, AND API gate is deny
   *   - matching models are all busy AND API gate is deny
   * In those cases the caller should requeue via `enqueue`.
   */
  tryReserve(req: TaskResourceRequirement): ReservationOutcome {
    const policy = this.slot().policy;
    const apiGate = policy.apiCost;

    const match = this.pickMatching(req);
    if (match) {
      const cap = match.maxConcurrent;
      const cur = this.inUse.get(match.id) ?? 0;
      if (cur < cap) {
        this.inUse.set(match.id, cur + 1);
        this.assignment.set(req.taskId, match.id);
        return { ok: true, kind: 'local', modelId: match.id };
      }
      // matching but busy → maybe API fallback
      if (this.apiAcceptable(req, apiGate)) {
        this.assignment.set(req.taskId, 'api');
        return { ok: true, kind: 'api', reason: `local model '${match.id}' busy` };
      }
      return { ok: false, reason: 'all-busy' };
    }

    // No matching local model — API fallback?
    if (this.apiAcceptable(req, apiGate)) {
      this.assignment.set(req.taskId, 'api');
      return { ok: true, kind: 'api', reason: 'no matching local model' };
    }
    if (apiGate === 'deny' && req.apiFallbackAllowed === false) {
      return { ok: false, reason: 'api-denied' };
    }
    if (apiGate === 'deny') return { ok: false, reason: 'api-denied' };
    return { ok: false, reason: 'no-match' };
  }

  /** Park the request; resolves when capacity opens up. */
  enqueue(req: TaskResourceRequirement): Promise<ReservationOutcome> {
    return new Promise((resolve) => {
      // Try once immediately — frees the caller from the common-case race.
      const eager = this.tryReserve(req);
      if (eager.ok) return resolve(eager);
      this.queue.push({ requirement: req, resolve });
    });
  }

  /** Release a previously reserved resource. Pumps the queue. */
  release(taskId: string): boolean {
    const target = this.assignment.get(taskId);
    if (!target) return false;
    this.assignment.delete(taskId);
    if (target !== 'api') {
      const cur = this.inUse.get(target) ?? 0;
      if (cur <= 1) this.inUse.delete(target);
      else this.inUse.set(target, cur - 1);
    }
    this.pumpQueue();
    return true;
  }

  /** Wipe state — tests / shutdown. */
  reset(): void {
    this.inUse.clear();
    this.assignment.clear();
    for (const q of this.queue) q.resolve({ ok: false, reason: 'no-match' });
    this.queue.length = 0;
  }

  // ──────────────── internals ───────────────────────────────────

  private pickMatching(req: TaskResourceRequirement): LocalLlmDecl | undefined {
    if (req.preferredModelId) {
      const m = this.pool.find((p) => p.id === req.preferredModelId);
      if (m && this.coversCapabilities(m, req.capabilities)) return m;
      return undefined;
    }
    // Pool order = config order. Tie-breaker = highest tokens/sec.
    const candidates = this.pool.filter((p) => this.coversCapabilities(p, req.capabilities));
    if (candidates.length === 0) return undefined;
    return candidates.reduce((best, cur) =>
      (cur.estimatedTokensPerSec ?? 0) > (best.estimatedTokensPerSec ?? 0) ? cur : best,
    );
  }

  private coversCapabilities(m: LocalLlmDecl, req: readonly LlmCapability[]): boolean {
    for (const c of req) {
      if (!m.capabilities.includes(c)) return false;
    }
    return true;
  }

  private apiAcceptable(req: TaskResourceRequirement, gate: DispatchPolicy['apiCost']): boolean {
    if (req.apiFallbackAllowed === false) return false;
    return gate === 'allow' || gate === 'prefer';
  }

  private pumpQueue(): void {
    if (this.queue.length === 0) return;
    const next: QueuedJob[] = [];
    for (const job of this.queue) {
      const res = this.tryReserve(job.requirement);
      if (res.ok) job.resolve(res);
      else next.push(job);
    }
    this.queue.length = 0;
    this.queue.push(...next);
  }
}

// ──────────────────── Defaults ────────────────────────────────────────

function defaultSlot(): ResolvedSlot {
  return {
    kind: 'active',
    policy: { noisyTasks: 'allow', longRunning: 'allow', apiCost: 'deny', pushFreq: 'high' },
    fromFallback: false,
  };
}
