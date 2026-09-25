/**
 * MSS M3.4 — Myelination metric (Phase 2 D0 dep).
 *
 * Origin: 내부 문서 `ROADMAP-memory-and-signal-substrate` §4.4 M3.4 +
 * 내부 문서 `RESEARCH-task-dispatch-strategy-2026-05-11` §7.
 *
 * Tracks signal emit frequency per category over a 1-hour rolling
 * window. Categories that fire ≥ 1000/h get auto-promoted to a
 * **fast-path** set — downstream consumers (MyelinPriorityBridge ·
 * Phase 2 D6) read this to boost dispatch priority for frequently
 * fired signals.
 *
 * Co-activation map (Hebbian — "cells that fire together wire
 * together"): tracks pairs of categories that fire within a short
 * window. Used by Phase 2 D6 to lift sibling tasks when one of a
 * co-activated pair runs.
 *
 * Pure-ish — uses an injected clock so deterministic tests can drive
 * window expiry. No IO; persistence lives in M3.6 (out of scope here).
 */

// ──────────────────── Constants ────────────────────────────────────────

/** Rolling window for emit-frequency tally. */
export const MYELIN_WINDOW_MS = 60 * 60 * 1000; // 1h

/** Threshold above which a category becomes fast-path. */
export const MYELIN_FAST_PATH_THRESHOLD = 1000;

/** Co-activation window — two emits within this gap counts as a pair. */
export const COACTIVATION_WINDOW_MS = 5 * 1000; // 5s

/** Boost cap for priority lift (Phase 2 D6 contract). */
export const MYELIN_BOOST_CAP = 2;

// ──────────────────── Types ────────────────────────────────────────────

export interface MyelinSnapshot {
  /** Emit count over the trailing 1h window. */
  count: number;
  /** True when count ≥ MYELIN_FAST_PATH_THRESHOLD. */
  fastPath: boolean;
  /** Recommended priority lift (0..MYELIN_BOOST_CAP). */
  boost: number;
}

export interface MyelinTopEntry {
  category: string;
  count: number;
  fastPath: boolean;
}

export interface MyelinCoActivationEntry {
  a: string;
  b: string;
  count: number;
}

export interface MyelinMetricOptions {
  /** Override clock for tests. Default `Date.now`. */
  now?: () => number;
}

// ──────────────────── Class ────────────────────────────────────────────

interface BucketState {
  timestamps: number[];
  lastEmittedAt: number;
}

export class MyelinMetric {
  private readonly buckets = new Map<string, BucketState>();
  private readonly coActivation = new Map<string, number>(); // key="a||b"
  private readonly now: () => number;

  constructor(opts: MyelinMetricOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  // ──────────────── emit ────────────────────────────────────────

  /**
   * Record an emit for `category`. The category string is opaque —
   * callers conventionally use dot-paths (`pty.error`, `intake.decompose`).
   */
  emit(category: string): void {
    const t = this.now();
    const bucket = this.bucketFor(category);
    bucket.timestamps.push(t);
    this.compact(bucket, t);

    // Co-activation: pair with every category that fired within the
    // coactivation window.
    for (const [other, state] of this.buckets) {
      if (other === category) continue;
      if (t - state.lastEmittedAt <= COACTIVATION_WINDOW_MS) {
        const key = pairKey(category, other);
        this.coActivation.set(key, (this.coActivation.get(key) ?? 0) + 1);
      }
    }

    bucket.lastEmittedAt = t;
  }

  // ──────────────── readers ────────────────────────────────────

  /**
   * Snapshot for a single category. Cheap — O(window) compaction +
   * O(1) thresholds. The boost is `MYELIN_BOOST_CAP` for fast-path,
   * `1` for the upper half of the threshold range, otherwise `0`.
   */
  snapshot(category: string): MyelinSnapshot {
    const bucket = this.buckets.get(category);
    if (!bucket) return { count: 0, fastPath: false, boost: 0 };
    this.compact(bucket, this.now());
    const count = bucket.timestamps.length;
    const fastPath = count >= MYELIN_FAST_PATH_THRESHOLD;
    let boost = 0;
    if (fastPath) boost = MYELIN_BOOST_CAP;
    else if (count >= MYELIN_FAST_PATH_THRESHOLD / 2) boost = 1;
    return { count, fastPath, boost };
  }

  /** Quick predicate — `snapshot(c).fastPath`. */
  isFastPath(category: string): boolean {
    return this.snapshot(category).fastPath;
  }

  /** Effective priority boost (0..MYELIN_BOOST_CAP). */
  boostFor(category: string): number {
    return this.snapshot(category).boost;
  }

  /**
   * Top-N categories by emit count over the window. Defaults to N=10
   * (dashboard pane size per ROADMAP §4.4).
   */
  top(n = 10): MyelinTopEntry[] {
    const t = this.now();
    const out: MyelinTopEntry[] = [];
    for (const [category, state] of this.buckets) {
      this.compact(state, t);
      if (state.timestamps.length === 0) continue;
      const count = state.timestamps.length;
      out.push({
        category,
        count,
        fastPath: count >= MYELIN_FAST_PATH_THRESHOLD,
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, n);
  }

  /**
   * Categories most often co-activated with `category` (sorted by
   * pair count, desc). Excludes the seed category.
   */
  coActivatedWith(category: string, n = 5): MyelinCoActivationEntry[] {
    const out: MyelinCoActivationEntry[] = [];
    for (const [key, count] of this.coActivation) {
      const [a, b] = key.split('||');
      if (a === category) out.push({ a: a!, b: b!, count });
      else if (b === category) out.push({ a: b!, b: a!, count });
    }
    out.sort((x, y) => y.count - x.count);
    return out.slice(0, n);
  }

  /** Whole co-activation map sorted (heatmap pane). */
  coActivationHeatmap(n = 20): MyelinCoActivationEntry[] {
    const out: MyelinCoActivationEntry[] = [];
    for (const [key, count] of this.coActivation) {
      const [a, b] = key.split('||');
      out.push({ a: a!, b: b!, count });
    }
    out.sort((x, y) => y.count - x.count);
    return out.slice(0, n);
  }

  // ──────────────── tracked categories ─────────────────────────

  /** Visible categories (those with at least one live emit). */
  categories(): string[] {
    const t = this.now();
    const out: string[] = [];
    for (const [cat, state] of this.buckets) {
      this.compact(state, t);
      if (state.timestamps.length > 0) out.push(cat);
    }
    return out;
  }

  /** Total live emits across every category. */
  totalEmits(): number {
    const t = this.now();
    let total = 0;
    for (const state of this.buckets.values()) {
      this.compact(state, t);
      total += state.timestamps.length;
    }
    return total;
  }

  /** Reset everything — test convenience. */
  reset(): void {
    this.buckets.clear();
    this.coActivation.clear();
  }

  // ──────────────── internals ──────────────────────────────────

  private bucketFor(category: string): BucketState {
    let state = this.buckets.get(category);
    if (!state) {
      state = { timestamps: [], lastEmittedAt: 0 };
      this.buckets.set(category, state);
    }
    return state;
  }

  private compact(bucket: BucketState, now: number): void {
    const cutoff = now - MYELIN_WINDOW_MS;
    while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
      bucket.timestamps.shift();
    }
  }
}

// ──────────────────── Helpers ──────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}
