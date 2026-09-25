/**
 * `TimeSlotManager` — Phase 2 D1 / RESEARCH §5.1.
 *
 * 24-hour calendar of slot rules. The dispatcher (D5 OpportunisticLauncher)
 * asks `currentSlot(date)` what's running right now; downstream policies
 * (D4 ResourceScheduler · D7 MorningDigestComposer) read the slot's
 * `dispatchPolicy` to decide whether to launch / suppress / re-route.
 *
 * Source of truth = **user-explicit ranges** (config), with a learned
 * fallback (D2 — 14-day average) wired through `LearnedFallback`. This
 * module owns the calendar shape + lookup, not the learning loop.
 *
 * The data model deliberately stays in plain TS so D2 / D5 can persist
 * + replay without dragging in YAML or DSL layers.
 */

// ──────────────────── Closed sets ──────────────────────────────────────

export const SLOT_KINDS = ['focused-work', 'active', 'idle', 'sleep'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export const PUSH_FREQS = ['low', 'medium', 'high', 'suppress'] as const;
export type PushFreq = (typeof PUSH_FREQS)[number];

export const DISPATCH_GATES = ['allow', 'prefer', 'deny'] as const;
export type DispatchGate = (typeof DISPATCH_GATES)[number];

export interface DispatchPolicy {
  /** Local-LLM-heavy task allow / deny / prefer. */
  noisyTasks: DispatchGate;
  /** Long-running task lift (sleep window prefers them). */
  longRunning: DispatchGate;
  /** API-cost gate — paid LLM calls. Default deny per E2. */
  apiCost: DispatchGate;
  /** Push notification cadence. */
  pushFreq: PushFreq;
}

export const DEFAULT_POLICY: Record<SlotKind, DispatchPolicy> = {
  'focused-work': { noisyTasks: 'deny', longRunning: 'deny', apiCost: 'deny', pushFreq: 'low' },
  'active': { noisyTasks: 'allow', longRunning: 'allow', apiCost: 'deny', pushFreq: 'high' },
  'idle': { noisyTasks: 'allow', longRunning: 'allow', apiCost: 'deny', pushFreq: 'medium' },
  'sleep': { noisyTasks: 'allow', longRunning: 'prefer', apiCost: 'deny', pushFreq: 'suppress' },
};

// ──────────────────── Ranges ───────────────────────────────────────────

/**
 * A clock-time interval expressed in minutes from local midnight.
 * `endMin` may exceed `1440` to denote a wrap-around (e.g. 23:00 →
 * 07:00 = `{start: 23*60, end: 31*60}`). `resolveSlot` normalises.
 */
export interface SlotRange {
  startMin: number;
  endMin: number;
  kind: SlotKind;
  /** Override of `DEFAULT_POLICY[kind]`. */
  policy?: Partial<DispatchPolicy>;
}

export interface TimeSlotManagerConfig {
  /** User-explicit ranges. Higher-index ranges win on overlap. */
  ranges?: SlotRange[];
  /** Default kind when no range matches + no fallback. Default 'active'. */
  defaultKind?: SlotKind;
  /** Optional learned fallback (D2). */
  fallback?: LearnedFallback;
  /** Override clock — tests. Default `() => new Date()`. */
  now?: () => Date;
}

export interface LearnedFallback {
  /** Returns the inferred kind for a given local minute-of-day. */
  inferKind: (minuteOfDay: number) => SlotKind | null;
}

// ──────────────────── Parse helpers ────────────────────────────────────

const HHMM = /^(\d{1,2}):(\d{2})$/;

export function parseClock(s: string): number {
  const m = HHMM.exec(s.trim());
  if (!m) throw new Error(`time-slot: invalid clock '${s}' (expected HH:MM)`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`time-slot: out-of-range clock '${s}'`);
  }
  return hh * 60 + mm;
}

/**
 * Build a SlotRange from a `HH:MM-HH:MM` string. When the end falls at
 * or before the start, the range is treated as wrapping past midnight.
 */
export function rangeFromText(
  text: string,
  kind: SlotKind,
  policy?: Partial<DispatchPolicy>,
): SlotRange {
  const parts = text.split('-');
  if (parts.length !== 2) throw new Error(`time-slot: bad range '${text}'`);
  const startMin = parseClock(parts[0]!);
  let endMin = parseClock(parts[1]!);
  if (endMin <= startMin) endMin += 24 * 60;
  const out: SlotRange = { startMin, endMin, kind };
  if (policy) out.policy = policy;
  return out;
}

// ──────────────────── Manager ──────────────────────────────────────────

export interface ResolvedSlot {
  kind: SlotKind;
  policy: DispatchPolicy;
  /** Range that matched (when from user-explicit config). */
  range?: SlotRange;
  /** True when the kind came from the learned fallback (D2). */
  fromFallback: boolean;
}

export class TimeSlotManager {
  private readonly ranges: SlotRange[];
  private readonly defaultKind: SlotKind;
  private readonly fallback: LearnedFallback | undefined;
  private readonly now: () => Date;

  constructor(config: TimeSlotManagerConfig = {}) {
    this.ranges = config.ranges ?? [];
    this.defaultKind = config.defaultKind ?? 'active';
    this.fallback = config.fallback;
    this.now = config.now ?? (() => new Date());
  }

  /**
   * Resolve the active slot for `when` (default = `now()`).
   * Lookup priority: explicit user ranges (last wins on overlap) →
   * learned fallback → defaultKind.
   */
  currentSlot(when?: Date): ResolvedSlot {
    const d = when ?? this.now();
    const mod = d.getHours() * 60 + d.getMinutes();
    const range = this.findRange(mod);
    if (range) {
      return {
        kind: range.kind,
        policy: mergePolicy(range.kind, range.policy),
        range,
        fromFallback: false,
      };
    }
    if (this.fallback) {
      const kind = this.fallback.inferKind(mod);
      if (kind) {
        return {
          kind,
          policy: mergePolicy(kind, undefined),
          fromFallback: true,
        };
      }
    }
    return {
      kind: this.defaultKind,
      policy: mergePolicy(this.defaultKind, undefined),
      fromFallback: false,
    };
  }

  /** Return all explicit ranges (caller order). Mostly for inspection. */
  listRanges(): readonly SlotRange[] {
    return this.ranges;
  }

  /** Convenience predicate — `currentSlot().kind === kind`. */
  isInSlot(kind: SlotKind, when?: Date): boolean {
    return this.currentSlot(when).kind === kind;
  }

  // ──────────────── internals ──────────────────────────────────

  /**
   * Find the matching range. Walks last-to-first so the highest-index
   * range wins on overlap (config "overlay" semantics).
   */
  private findRange(modMin: number): SlotRange | undefined {
    for (let i = this.ranges.length - 1; i >= 0; i -= 1) {
      const r = this.ranges[i]!;
      if (rangeContains(r, modMin)) return r;
    }
    return undefined;
  }
}

function rangeContains(r: SlotRange, modMin: number): boolean {
  // Range is [startMin, endMin) in minute-of-day. End may wrap > 1440.
  if (modMin >= r.startMin && modMin < r.endMin) return true;
  if (r.endMin > 1440) {
    const wrapped = modMin + 1440;
    if (wrapped >= r.startMin && wrapped < r.endMin) return true;
  }
  return false;
}

function mergePolicy(kind: SlotKind, override: Partial<DispatchPolicy> | undefined): DispatchPolicy {
  return { ...DEFAULT_POLICY[kind], ...(override ?? {}) };
}
