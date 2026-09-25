// ── PFC-S3.2: SPC (Statistical Process Control) — ProcessHealthMetric ──
//
// Detection primitive #2 in the CFT detection batch (Andon → SPC →
// Poka-Yoke). Tracks a named time series (latency, answer length,
// retries, etc.), maintains a rolling ring buffer of the last N
// samples, and flags z-score outliers (>2σ by default).
//
// Design notes:
//   - In-memory only. Process restart resets state by design — if a
//     series matters across restarts, persist it upstream.
//   - Incremental mean/stddev via Welford's online algorithm for O(1)
//     push; recompute on wrap-around eject (capacity 20 by default,
//     so amortized cheap).
//   - Warm-up = 5 samples. Before that, outlierZ stays undefined so
//     cold-start noise doesn't trigger false alerts.
//   - Tool-layer binding lives in `./tools/emit-process-health.ts`;
//     this module is pure data.

export const SPC_DEFAULT_CAPACITY = 20;
export const SPC_WARMUP_N = 5;
export const SPC_SIGMA_THRESHOLD = 2;

export interface ProcessHealthSample {
  series: string;
  value: number;
  ts: number;
}

export interface ProcessHealthStats {
  series: string;
  n: number;
  mean: number;
  stddev: number;
  lastValue: number;
  capacity: number;
  warmupN: number;
  sigmaThreshold: number;
  /** z-score, only set when abs(z) > sigmaThreshold AND n >= warmup. */
  outlierZ?: number;
  sign?: 'over' | 'under';
}

interface SeriesState {
  name: string;
  capacity: number;
  values: number[];        // ring buffer as array
  writeIdx: number;
  filled: boolean;
  sum: number;
  sumSq: number;
}

const state = new Map<string, SeriesState>();

function ensureSeries(name: string, capacity = SPC_DEFAULT_CAPACITY): SeriesState {
  const existing = state.get(name);
  if (existing) return existing;
  const fresh: SeriesState = {
    name,
    capacity,
    values: [],
    writeIdx: 0,
    filled: false,
    sum: 0,
    sumSq: 0,
  };
  state.set(name, fresh);
  return fresh;
}

/** Push a sample onto the rolling buffer and return updated stats.
 *  Rejects empty series names and non-finite values. */
export function recordSample(
  series: string,
  value: number,
  opts: { now?: number; capacity?: number } = {},
): ProcessHealthStats {
  if (!series || !series.trim()) {
    throw new Error('recordSample: series name is required');
  }
  if (!Number.isFinite(value)) {
    throw new Error(`recordSample: value must be a finite number (got ${value})`);
  }
  const name = series.trim();
  const s = ensureSeries(name, opts.capacity ?? SPC_DEFAULT_CAPACITY);

  if (s.filled) {
    // Ring is full — eject the oldest before push.
    const old = s.values[s.writeIdx]!;
    s.values[s.writeIdx] = value;
    s.writeIdx = (s.writeIdx + 1) % s.capacity;
    // Incremental adjust, then recompute from scratch to avoid
    // floating drift after many ejections.
    s.sum += value - old;
    s.sumSq += value * value - old * old;
    if (s.writeIdx % Math.max(1, s.capacity) === 0) {
      // Periodic full recompute to reset drift. Cheap at capacity 20.
      let sum = 0; let sumSq = 0;
      for (const v of s.values) { sum += v; sumSq += v * v; }
      s.sum = sum; s.sumSq = sumSq;
    }
  } else {
    s.values.push(value);
    s.writeIdx++;
    s.sum += value;
    s.sumSq += value * value;
    if (s.writeIdx >= s.capacity) {
      s.filled = true;
      s.writeIdx = 0;
    }
  }

  const n = s.filled ? s.capacity : s.values.length;
  const mean = n > 0 ? s.sum / n : 0;
  const variance = n > 1 ? Math.max(0, s.sumSq / n - mean * mean) : 0;
  const stddev = Math.sqrt(variance);

  const stats: ProcessHealthStats = {
    series: name,
    n,
    mean,
    stddev,
    lastValue: value,
    capacity: s.capacity,
    warmupN: SPC_WARMUP_N,
    sigmaThreshold: SPC_SIGMA_THRESHOLD,
  };

  // Outlier evaluation — only past warmup and when stddev has signal.
  if (n >= SPC_WARMUP_N && stddev > 0) {
    const z = (value - mean) / stddev;
    if (Math.abs(z) > SPC_SIGMA_THRESHOLD) {
      stats.outlierZ = z;
      stats.sign = z > 0 ? 'over' : 'under';
    }
  }

  return stats;
}

/** Read-only snapshot; returns null when series unknown. */
export function getStats(series: string): ProcessHealthStats | null {
  const s = state.get(series);
  if (!s) return null;
  const n = s.filled ? s.capacity : s.values.length;
  if (n === 0) return null;
  const mean = s.sum / n;
  const variance = n > 1 ? Math.max(0, s.sumSq / n - mean * mean) : 0;
  const stddev = Math.sqrt(variance);
  return {
    series,
    n,
    mean,
    stddev,
    lastValue: s.filled
      ? s.values[(s.writeIdx - 1 + s.capacity) % s.capacity]!
      : s.values[s.values.length - 1]!,
    capacity: s.capacity,
    warmupN: SPC_WARMUP_N,
    sigmaThreshold: SPC_SIGMA_THRESHOLD,
  };
}

export function listSeries(): string[] {
  return Array.from(state.keys()).sort();
}

export function clearSpcForTest(): void {
  state.clear();
}
