// ── Animation context — VTM-inspired frame-sampled tween controller ──
//
// Phase 4b (2026-04-20). Synchronous TUI animation = progress sampling.
// There's no render loop to drive frames at 60fps; the widget asks the
// controller "what's my progress?" whenever it renders, and the
// controller computes a 0..1 value based on wall-clock elapsed time +
// the configured duration.
//
// This shape is load-bearing for two use cases the PLAN calls out:
//   1. LLM playback — `animate(widgetId, { from, to, duration, curve })`
//      then `getCanvas(widgetId, 'progress=0.7')` to snapshot mid-animation
//   2. Declarative state transitions — a widget declares an animated
//      field (opacity, scroll, color) and reads `ctx.animate.progress(key)`
//      in render; the host auto-triggers re-renders via `requestRender`
//      until progress reaches 1.0 (a tickler drives this in P8+ arcs).
//
// The controller doesn't interpolate values itself — curves.ts returns a
// progress number; the widget combines that with its own `from`/`to`
// lerp. Keeps the controller payload-agnostic (strings, colors, offsets
// all work the same way).

import type { Curve } from './curves.js';
import { resolveCurve } from './curves.js';

export interface TweenSpec {
  /** Unique key per widget instance — enables multi-concurrent tweens
   *  on the same widget (e.g. `scroll` + `opacity`). */
  readonly key: string;
  /** Total duration in milliseconds. */
  readonly durationMs: number;
  /** Easing curve (function or named). Defaults to `linear`. */
  readonly curve?: Curve | string;
  /** Start time in ms (epoch). Defaults to `Date.now()`. */
  readonly startAt?: number;
  /** Optional completion callback — fires once when progress reaches 1.0
   *  on a subsequent `progress(key)` sample. */
  readonly onDone?: () => void;
}

interface TweenEntry {
  key: string;
  durationMs: number;
  curve: Curve;
  startAt: number;
  onDone?: () => void;
  doneFired: boolean;
}

export class AnimationController {
  private readonly tweens = new Map<string, TweenEntry>();
  /** Override for tests — wall clock if unset. */
  private nowFn: () => number = () => Date.now();

  /** Start (or restart) a tween. If a tween with the same key is active,
   *  it's replaced — the new `startAt` / `durationMs` / `curve` win. */
  tween(spec: TweenSpec): void {
    const entry: TweenEntry = {
      key: spec.key,
      durationMs: Math.max(1, spec.durationMs),
      curve: resolveCurve(spec.curve),
      startAt: spec.startAt ?? this.nowFn(),
      onDone: spec.onDone,
      doneFired: false,
    };
    this.tweens.set(spec.key, entry);
  }

  /** Sample the progress for `key`. Returns the eased value:
   *  - key not registered → 0
   *  - before startAt → 0
   *  - [startAt, startAt + durationMs) → curve(linear progress)
   *  - at or after end → 1, and fires onDone on the first such sample */
  progress(key: string): number {
    const t = this.tweens.get(key);
    if (!t) return 0;
    const now = this.nowFn();
    const elapsed = now - t.startAt;
    if (elapsed <= 0) return 0;
    if (elapsed >= t.durationMs) {
      if (!t.doneFired) {
        t.doneFired = true;
        try { t.onDone?.(); } catch { /* swallow — animation progress must not throw */ }
      }
      return 1;
    }
    return t.curve(elapsed / t.durationMs);
  }

  /** Observation — has this tween completed (reached t=1 at least once)? */
  isDone(key: string): boolean {
    return this.tweens.get(key)?.doneFired ?? false;
  }

  /** Is there any active (pre-done) tween? Host uses this to decide
   *  whether to schedule another render frame. */
  hasActive(): boolean {
    const now = this.nowFn();
    for (const t of this.tweens.values()) {
      if (now - t.startAt < t.durationMs) return true;
    }
    return false;
  }

  /** Remove a tween by key. No-op if absent. */
  cancel(key: string): void {
    this.tweens.delete(key);
  }

  /** Remove all tweens. */
  clear(): void {
    this.tweens.clear();
  }

  /** Test-only — substitute a clock. */
  _setNowForTesting(fn: () => number): void {
    this.nowFn = fn;
  }
}

/** Convenience — linear interpolation between two numbers by progress t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp-and-round — for row/col integer values. */
export function lerpInt(a: number, b: number, t: number): number {
  return Math.round(lerp(a, b, t));
}
