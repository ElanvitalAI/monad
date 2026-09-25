// ── PFC-S3 P2: 4-axis budget meter ──
//
// Tracks the 4 axes PFC-S2 auto-research needs:
//   tokens       — total tokens consumed (sum across models)
//   wallclockMs  — wall-clock time spent
//   usd          — absolute USD spend
//   weeklyUsd    — rolling 7-day spend; auto-resets at Monday 00:00 UTC
//
// A spec omits any axis to mark it unlimited. Trip detection compares
// current usage against cap; `warning()` at 90%; `tripped()` at 100%.
// Persistence is atomic JSON following the PX-2 tmp+rename pattern so
// a crash mid-write does not corrupt the meter.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type BudgetAxis = 'tokens' | 'wallclockMs' | 'usd' | 'weeklyUsd';

export interface BudgetSpec {
  tokens?: number;
  wallclockMs?: number;
  usd?: number;
  weeklyUsd?: number;
}

export interface BudgetUsage {
  tokens: number;
  wallclockMs: number;
  usd: number;
  weeklyUsd: number;
  weekResetAt: number;   // ms epoch of the NEXT Monday 00:00 UTC
}

export interface BudgetSnapshot extends BudgetUsage {
  remaining: Partial<Record<BudgetAxis, number>>;
  tripped: BudgetAxis[];
  warning: BudgetAxis[];
}

export const BUDGET_WARNING_RATIO = 0.9;

export class BudgetMeter {
  private usage: BudgetUsage;

  constructor(
    private readonly spec: BudgetSpec,
    initial?: Partial<BudgetUsage>,
    now: number = Date.now(),
  ) {
    this.usage = {
      tokens: initial?.tokens ?? 0,
      wallclockMs: initial?.wallclockMs ?? 0,
      usd: initial?.usd ?? 0,
      weeklyUsd: initial?.weeklyUsd ?? 0,
      weekResetAt: initial?.weekResetAt ?? nextMondayUtc(now),
    };
  }

  add(delta: Partial<Omit<BudgetUsage, 'weekResetAt'>>, now: number = Date.now()): void {
    this.resetWeekly(now);
    for (const k of ['tokens', 'wallclockMs', 'usd', 'weeklyUsd'] as const) {
      const v = delta[k];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`BudgetMeter.add rejects negative/non-finite ${k}=${v}`);
      }
      this.usage[k] += v;
    }
  }

  snapshot(now: number = Date.now()): BudgetSnapshot {
    this.resetWeekly(now);
    const remaining: BudgetSnapshot['remaining'] = {};
    const tripped: BudgetAxis[] = [];
    const warning: BudgetAxis[] = [];
    for (const axis of ['tokens', 'wallclockMs', 'usd', 'weeklyUsd'] as const) {
      const cap = this.spec[axis];
      if (cap === undefined) continue;
      const used = this.usage[axis];
      remaining[axis] = Math.max(0, cap - used);
      if (used >= cap) tripped.push(axis);
      else if (used >= cap * BUDGET_WARNING_RATIO) warning.push(axis);
    }
    return {
      ...this.usage,
      remaining,
      tripped,
      warning,
    };
  }

  tripped(now: number = Date.now()): BudgetAxis[] {
    return this.snapshot(now).tripped;
  }

  warning(now: number = Date.now()): BudgetAxis[] {
    return this.snapshot(now).warning;
  }

  resetWeekly(now: number = Date.now()): void {
    if (now >= this.usage.weekResetAt) {
      this.usage.weeklyUsd = 0;
      this.usage.weekResetAt = nextMondayUtc(now);
    }
  }

  async persist(path: string): Promise<void> {
    atomicWriteJson(path, { spec: this.spec, usage: this.usage });
  }

  static load(path: string, spec: BudgetSpec, now: number = Date.now()): BudgetMeter {
    if (!existsSync(path)) return new BudgetMeter(spec, undefined, now);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
        spec?: BudgetSpec;
        usage?: Partial<BudgetUsage>;
      };
      return new BudgetMeter(spec, raw.usage, now);
    } catch {
      return new BudgetMeter(spec, undefined, now);
    }
  }

  /** Test seam — expose current usage directly. */
  rawUsage(): Readonly<BudgetUsage> { return this.usage; }
}

// ── Helpers ────────────────────────────────────────────────────────────

function nextMondayUtc(now: number): number {
  const d = new Date(now);
  // 0=Sun, 1=Mon, ... — offset to next Monday 00:00 UTC.
  const dow = d.getUTCDay();
  const daysToMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + daysToMon,
    0, 0, 0, 0,
  );
  return next;
}

function atomicWriteJson(path: string, value: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/** Render a BudgetSnapshot as a single-line operator string — used by
 *  loop-prompt.ts. Drops axes that have no cap (unlimited). */
export function formatBudgetLine(snap: BudgetSnapshot): string {
  const parts: string[] = [];
  if (snap.remaining.tokens !== undefined) {
    parts.push(`tokens ${formatK(snap.tokens)}/${formatK(snap.tokens + snap.remaining.tokens)}`);
  }
  if (snap.remaining.usd !== undefined) {
    parts.push(`$${snap.usd.toFixed(2)}/$${(snap.usd + snap.remaining.usd).toFixed(2)}`);
  }
  if (snap.remaining.wallclockMs !== undefined) {
    parts.push(`${formatHMS(snap.wallclockMs)}/${formatHMS(snap.wallclockMs + snap.remaining.wallclockMs)}`);
  }
  return parts.join(' · ');
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatHMS(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
