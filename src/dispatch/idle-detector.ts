/**
 * `IdleDetector` — Phase 2 D3 / RESEARCH §5.3.
 *
 * Aggregates "user is/isn't idle" signals from multiple surfaces:
 *   - dashboard input (keystroke / mouse via D5 wiring)
 *   - terminal pane keystroke
 *   - chat send
 *   - voice activation
 *
 * Anyone who sees user activity calls `notifyActivity('<surface>')`.
 * The detector keeps the timestamp of the most recent activity per
 * surface and exposes `isIdle()` / `idleMs()` against a configurable
 * threshold (default 15 minutes per E4).
 *
 * Stateless beyond an in-memory Map; no IO. Designed to plug into D5
 * OpportunisticLauncher's 4-axes check.
 */

// ──────────────────── Constants ────────────────────────────────────────

export const DEFAULT_IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min (E4)

// ──────────────────── Types ────────────────────────────────────────────

export type IdleSurface = string;

export interface IdleDetectorOptions {
  /** Idle threshold (ms). Default 15 min. */
  thresholdMs?: number;
  /** Override clock for tests. Default `Date.now`. */
  now?: () => number;
}

export interface IdleStatus {
  /** True when no surface has registered activity within thresholdMs. */
  idle: boolean;
  /** Milliseconds since the most recent activity across all surfaces.
   *  `Infinity` when no surface has ever registered activity. */
  idleMs: number;
  /** Surface that fired the most recent activity (when known). */
  lastSurface: IdleSurface | null;
}

// ──────────────────── Detector ─────────────────────────────────────────

export class IdleDetector {
  private readonly thresholdMs: number;
  private readonly now: () => number;
  private readonly perSurface = new Map<IdleSurface, number>();
  private lastSurface: IdleSurface | null = null;

  constructor(opts: IdleDetectorOptions = {}) {
    this.thresholdMs = Math.max(0, opts.thresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS);
    this.now = opts.now ?? Date.now;
  }

  /** Threshold currently in effect. */
  threshold(): number {
    return this.thresholdMs;
  }

  /** Record that `surface` saw user activity. Cheap O(1). */
  notifyActivity(surface: IdleSurface): void {
    const t = this.now();
    this.perSurface.set(surface, t);
    this.lastSurface = surface;
  }

  /** Latest activity timestamp across every surface, or null when none. */
  lastActivityAt(): number | null {
    let max: number | null = null;
    for (const t of this.perSurface.values()) {
      if (max === null || t > max) max = t;
    }
    return max;
  }

  status(): IdleStatus {
    const last = this.lastActivityAt();
    if (last === null) {
      return { idle: true, idleMs: Infinity, lastSurface: null };
    }
    const diff = Math.max(0, this.now() - last);
    return {
      idle: diff >= this.thresholdMs,
      idleMs: diff,
      lastSurface: this.lastSurface,
    };
  }

  /** Convenience: `status().idle`. */
  isIdle(): boolean {
    return this.status().idle;
  }

  /** Wipe surface state. Tests only. */
  reset(): void {
    this.perSurface.clear();
    this.lastSurface = null;
  }
}

// ── §5-③ Phase D: process-wide idle for the continuation scheduler ──
//
// One shared IdleDetector so the scheduler reads isIdle() while the
// daemon's user-input path calls notifyDaemonActivity() — this makes the
// scheduler *actually* idle-gated (continuation fires only after the
// operator has been quiet past threshold), instead of the always-idle
// fallback. Continuation turns run through a separate path (chat.ts
// runTurn) and deliberately do NOT notify, so the loop never resets its
// own idle window.

/** Shared idle detector for the §5-③ continuation scheduler. */
export const daemonIdleDetector = new IdleDetector();

/** Record operator/user activity on a daemon input surface (ACP prompt,
 *  PWA/HTTP prompt, chat). Resets the continuation scheduler's idle
 *  window so it pauses while the user is active. */
export function notifyDaemonActivity(surface: IdleSurface = 'daemon-input'): void {
  daemonIdleDetector.notifyActivity(surface);
}
