// F-B5a — Pure playback state machine for the reactive playground.
//
// Advances a scenario one step at a time, driven by either manual
// key presses (n / p / r) or an auto-advance timer (Space toggles).
// The controller is strictly pure — it does NOT dispatch steps
// against a harness; it just publishes the current step index. The
// consumer subscribes via `onChange` and runs the actual scenario
// runner against the harness when the index advances.
//
// Keeping it timer-injectable lets unit tests fast-forward without
// real setTimeouts, and lets the UI layer pass the host's frame
// scheduler for deterministic remount behavior.

export interface PlaybackTimer {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PlaybackState {
  /** 0-indexed cursor. -1 means "no step selected yet". */
  stepIndex: number;
  /** Total steps in the current scenario. Controller never advances
   *  past `total - 1`. */
  total: number;
  /** True when auto-advance is running. */
  playing: boolean;
}

export interface PlaybackControllerOptions {
  total: number;
  /** Milliseconds between auto-advances when `playing`. Default 2000. */
  intervalMs?: number;
  /** Injected timer. Defaults to real `setTimeout`. Tests pass a
   *  virtual timer to avoid real clock waits. */
  timer?: PlaybackTimer;
  /** Initial step index. Defaults to -1 (nothing selected). */
  initialStep?: number;
}

export class PlaybackController {
  private state: PlaybackState;
  private readonly intervalMs: number;
  private readonly timer: PlaybackTimer;
  private listeners = new Set<(s: PlaybackState) => void>();
  private pendingTick: unknown = null;

  constructor(opts: PlaybackControllerOptions) {
    this.intervalMs = opts.intervalMs ?? 2000;
    this.timer = opts.timer ?? defaultTimer();
    this.state = {
      stepIndex: opts.initialStep ?? -1,
      total: Math.max(0, opts.total),
      playing: false,
    };
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  /** Subscribe to state transitions. Returns an unsubscribe fn. */
  onChange(listener: (s: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Update total (e.g. after a scenario recompile). Clamps the
   *  current index into range. Pauses if currently playing past the
   *  new end. */
  setTotal(total: number): void {
    const clamped = Math.max(0, total);
    const idx = this.state.stepIndex >= clamped ? clamped - 1 : this.state.stepIndex;
    const changed = clamped !== this.state.total || idx !== this.state.stepIndex;
    if (!changed && this.state.playing) return;
    this.state = { ...this.state, total: clamped, stepIndex: idx };
    if (this.state.playing && this.state.stepIndex >= clamped - 1) {
      this.pause();
      return;
    }
    this.notify();
  }

  next(): boolean {
    if (this.state.stepIndex >= this.state.total - 1) return false;
    this.state = { ...this.state, stepIndex: this.state.stepIndex + 1 };
    this.notify();
    return true;
  }

  prev(): boolean {
    if (this.state.stepIndex <= 0) return false;
    this.state = { ...this.state, stepIndex: this.state.stepIndex - 1 };
    this.notify();
    return true;
  }

  reset(): void {
    this.cancelPending();
    this.state = { ...this.state, stepIndex: -1, playing: false };
    this.notify();
  }

  play(): void {
    if (this.state.playing) return;
    if (this.state.total === 0) return;
    this.state = { ...this.state, playing: true };
    this.notify();
    this.scheduleTick();
  }

  pause(): void {
    if (!this.state.playing) return;
    this.cancelPending();
    this.state = { ...this.state, playing: false };
    this.notify();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  dispose(): void {
    this.cancelPending();
    this.listeners.clear();
  }

  private scheduleTick(): void {
    this.cancelPending();
    this.pendingTick = this.timer.setTimeout(() => {
      this.pendingTick = null;
      if (!this.state.playing) return;
      const advanced = this.next();
      if (!advanced) {
        // Hit the end → auto-pause.
        this.state = { ...this.state, playing: false };
        this.notify();
        return;
      }
      if (this.state.stepIndex >= this.state.total - 1) {
        this.state = { ...this.state, playing: false };
        this.notify();
        return;
      }
      this.scheduleTick();
    }, this.intervalMs);
  }

  private cancelPending(): void {
    if (this.pendingTick !== null) {
      this.timer.clearTimeout(this.pendingTick);
      this.pendingTick = null;
    }
  }

  private notify(): void {
    const snap = this.getState();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* listener isolate */ }
    }
  }
}

function defaultTimer(): PlaybackTimer {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
