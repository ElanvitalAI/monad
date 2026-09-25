// Y2 user-activity monitor · idle vs active state for background scheduler.
// Cf. ROADMAP-background-reasoning §5.3 onUserActive/onUserIdle.
// Pluggable cpu sampler so production wires os.loadavg() and tests inject fakes.

export type ActivityState = 'idle' | 'active';

export interface CpuSampler {
  /** Normalized 0-1 cpu load over the last sampling window. */
  load(): number;
}

export interface UserActivityMonitorOpts {
  /** CPU ratio above which user counts as "active". */
  threshold: number;
  /** Hysteresis margin to avoid flapping. Default 0.1. */
  hysteresis?: number;
  sampler: CpuSampler;
  now?: () => number;
}

export interface ActivitySnapshot {
  state: ActivityState;
  load: number;
  at: number;
}

export class UserActivityMonitor {
  private readonly threshold: number;
  private readonly hysteresis: number;
  private readonly sampler: CpuSampler;
  private readonly clock: () => number;
  private state: ActivityState = 'idle';
  private listeners: ((s: ActivitySnapshot) => void)[] = [];

  constructor(opts: UserActivityMonitorOpts) {
    this.threshold = opts.threshold;
    this.hysteresis = opts.hysteresis ?? 0.1;
    this.sampler = opts.sampler;
    this.clock = opts.now ?? Date.now;
  }

  sample(): ActivitySnapshot {
    const load = this.sampler.load();
    const prev = this.state;
    if (prev === 'idle' && load >= this.threshold) {
      this.state = 'active';
    } else if (prev === 'active' && load < this.threshold - this.hysteresis) {
      this.state = 'idle';
    }
    const snap = { state: this.state, load, at: this.clock() };
    if (prev !== this.state) {
      for (const fn of this.listeners) fn(snap);
    }
    return snap;
  }

  current(): ActivityState {
    return this.state;
  }

  onChange(fn: (s: ActivitySnapshot) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }
}

/** Default sampler backed by os.loadavg()[0] normalized by cpu count.
 *  Returns a value clamped to [0, 1]. */
export function createOsLoadSampler(deps?: {
  loadavg?: () => number[];
  cpuCount?: () => number;
}): CpuSampler {
  const loadavg = deps?.loadavg ?? ((): number[] => {
    // Lazy import keeps tests deterministic when deps injected.
    const os = require('node:os') as typeof import('node:os');
    return os.loadavg();
  });
  const cpuCount = deps?.cpuCount ?? ((): number => {
    const os = require('node:os') as typeof import('node:os');
    return Math.max(1, os.cpus().length);
  });
  return {
    load(): number {
      const avg = loadavg()[0] ?? 0;
      const n = cpuCount();
      const ratio = avg / n;
      if (!Number.isFinite(ratio) || ratio < 0) return 0;
      return ratio > 1 ? 1 : ratio;
    },
  };
}
