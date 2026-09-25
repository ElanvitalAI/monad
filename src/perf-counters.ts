// ── Perf counters — opt-in draw / debug / stdout instrumentation ──
//
// Used to diagnose post-debug-feature slowdown. Three orthogonal
// counters, all off by default so the steady-state hot path costs
// exactly one boolean branch. When the user types `/perf on`
// (wired in dashboard.ts), this module starts collecting:
//
//   • drawLatency — a rolling histogram of render() wall-clock
//     durations. Source: src/tui.ts::render wraps its body with
//     perf.markDrawStart / perf.markDrawEnd.
//   • debugCalls  — per-category Map counter. debug-log.ts::log()
//     increments this when perf is on. Answers "which category is
//     spamming?" without tailing the file.
//   • stdoutWrites — every direct process.stdout.write + every
//     coordinator frame write records bytes + call count here.
//     Answers "is input still bypassing the frame cache?".
//
// Why not always-on: each increment is ~20ns, which at 10k events/s
// adds 0.2ms per frame. Negligible individually, but the whole point
// of this module is to measure perf — so we gate everything on a
// single boolean the /perf slash flips.
//
// Ring buffer sizing: 120 frames of latency samples = ~2s at 60fps
// or ~20s at typical TUI redraw rate. Enough to catch a streaming
// burst, small enough to stay under a few KB.

const RING_CAP = 120;

class DrawLatencyRing {
  private samples: Float64Array = new Float64Array(RING_CAP);
  private count = 0;
  private idx = 0;
  private lastStart = 0;

  markStart(): void {
    this.lastStart = performance.now();
  }

  markEnd(): void {
    if (this.lastStart === 0) return;
    const dur = performance.now() - this.lastStart;
    this.samples[this.idx] = dur;
    this.idx = (this.idx + 1) % RING_CAP;
    if (this.count < RING_CAP) this.count++;
    this.lastStart = 0;
  }

  reset(): void {
    this.samples = new Float64Array(RING_CAP);
    this.count = 0;
    this.idx = 0;
    this.lastStart = 0;
  }

  /** Return sorted copy of current samples (newest last) and derived
   *  percentiles. Returns null when empty — callers render "no data"
   *  rather than divide-by-zero-ing into bogus percentiles. */
  snapshot(): { n: number; p50: number; p90: number; p99: number; max: number; mean: number } | null {
    if (this.count === 0) return null;
    const arr = Array.from(this.samples.slice(0, this.count)).sort((a, b) => a - b);
    const pct = (p: number): number => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))]!;
    const sum = arr.reduce((s, v) => s + v, 0);
    return {
      n:   arr.length,
      p50: pct(0.5),
      p90: pct(0.9),
      p99: pct(0.99),
      max: arr[arr.length - 1]!,
      mean: sum / arr.length,
    };
  }
}

class CategoryCounter {
  private counts = new Map<string, number>();
  private total = 0;

  bump(category: string, delta: number = 1): void {
    this.counts.set(category, (this.counts.get(category) ?? 0) + delta);
    this.total += delta;
  }

  reset(): void {
    this.counts.clear();
    this.total = 0;
  }

  /** Top-N entries by count, descending. */
  top(n: number = 10): Array<{ category: string; count: number }> {
    return Array.from(this.counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([category, count]) => ({ category, count }));
  }

  getTotal(): number { return this.total; }
}

class StdoutCounter {
  private calls = 0;
  private bytes = 0;
  private coordinatorCalls = 0;
  private coordinatorBytes = 0;

  recordDirect(byteLen: number): void {
    this.calls++;
    this.bytes += byteLen;
  }

  recordCoordinator(byteLen: number): void {
    this.coordinatorCalls++;
    this.coordinatorBytes += byteLen;
  }

  reset(): void {
    this.calls = 0;
    this.bytes = 0;
    this.coordinatorCalls = 0;
    this.coordinatorBytes = 0;
  }

  snapshot(): {
    directCalls: number;
    directBytes: number;
    coordinatorCalls: number;
    coordinatorBytes: number;
  } {
    return {
      directCalls: this.calls,
      directBytes: this.bytes,
      coordinatorCalls: this.coordinatorCalls,
      coordinatorBytes: this.coordinatorBytes,
    };
  }
}

class PerfCounters {
  /** Single master gate. Off = every mark/bump/record is a branch-
   *  return. Callers are responsible for checking `enabled` before
   *  computing expensive side-inputs, since the internal short-
   *  circuit still walks through the function prologue. */
  enabled = false;
  private startedAt = 0;

  readonly draw = new DrawLatencyRing();
  readonly debugCalls = new CategoryCounter();
  readonly stdout = new StdoutCounter();

  enable(): void {
    this.enabled = true;
    this.startedAt = performance.now();
    this.draw.reset();
    this.debugCalls.reset();
    this.stdout.reset();
  }

  disable(): void {
    this.enabled = false;
  }

  toggle(): boolean {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  markDrawStart(): void {
    if (!this.enabled) return;
    this.draw.markStart();
  }

  markDrawEnd(): void {
    if (!this.enabled) return;
    this.draw.markEnd();
  }

  bumpDebugCall(category: string): void {
    if (!this.enabled) return;
    this.debugCalls.bump(category);
  }

  recordStdoutWrite(byteLen: number, viaCoordinator: boolean = false): void {
    if (!this.enabled) return;
    if (viaCoordinator) this.stdout.recordCoordinator(byteLen);
    else this.stdout.recordDirect(byteLen);
  }

  /** Render a compact multi-line report suitable for the log pane.
   *  Structured so the user can paste it into bug reports without
   *  any further formatting. */
  report(): string {
    const elapsedS = this.enabled
      ? ((performance.now() - this.startedAt) / 1000).toFixed(1)
      : 'n/a';
    const lines: string[] = [];
    lines.push(`perf · enabled=${this.enabled} · collecting for ${elapsedS}s`);

    const d = this.draw.snapshot();
    if (d === null) {
      lines.push('  draw: (no samples)');
    } else {
      lines.push(
        `  draw: n=${d.n} p50=${d.p50.toFixed(1)}ms p90=${d.p90.toFixed(1)}ms p99=${d.p99.toFixed(1)}ms max=${d.max.toFixed(1)}ms mean=${d.mean.toFixed(1)}ms`,
      );
    }

    const s = this.stdout.snapshot();
    lines.push(
      `  stdout: direct=${s.directCalls}(${s.directBytes}B) coordinator=${s.coordinatorCalls}(${s.coordinatorBytes}B)`,
    );

    const dbgTotal = this.debugCalls.getTotal();
    lines.push(`  debug.log calls: total=${dbgTotal}`);
    const top = this.debugCalls.top(5);
    for (const t of top) {
      lines.push(`    ${t.category}  ${t.count}`);
    }
    return lines.join('\n');
  }
}

/** Singleton. Import as `perf` and call `perf.markDrawStart()` etc.
 *  Disabled by default — `perf.enable()` is user-triggered only. */
export const perf = new PerfCounters();
