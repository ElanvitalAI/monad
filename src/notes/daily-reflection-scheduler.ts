// R6 v2 (2026-05-09) — daily reflection scheduler.
//
// Self-contained ticker that fires the daily-reflection pipeline
// once per day at a configurable wall-clock hour:
//   1. buildDailyReflection(today)         (always · pure · ms-cheap)
//   2. polish(snapshot)                    (optional · LLM)
//   3. notifyDailyReflection(snapshot, hanseiText?)
//
// Why a dedicated scheduler instead of `src/scheduler/**`:
//   The generic scheduler is SQLite-backed with cron parsing + retries
//   + dispatch — overkill for "fire once a day at 21:00." A 60s tick
//   that flips when the hour crosses is ~30 LOC + zero new deps. The
//   generic scheduler stays in scope when we add user-defined alarms
//   (different track).
//
// Idempotency: a date-key guard (`lastFiredDate`) prevents double
// firing if the tick races near the boundary. Daemon restart drops
// the in-memory guard but the date-key bump in `notifyDailyReflection`
// SW tag (`daily-reflection-<date>`) collapses duplicates client-side.
//
// Cross-ref:
//   src/notes/daily-reflection.ts (buildDailyReflection)
//   src/notes/daily-reflection-polish.ts (Hansei polish)
//   src/web-push/notify-daily-reflection.ts (push fan-out)

import { debug } from '../debug/log.js';
import {
  buildDailyReflection,
  dateKey,
  type DailyReflectionInput,
  type DailyReflectionSnapshot,
} from './daily-reflection.js';
import type { DailyReflectionPolishCallable } from './daily-reflection-polish.js';
import { notifyDailyReflection } from '../web-push/notify-daily-reflection.js';

export interface DailyReflectionSchedulerOpts {
  /** 0-23 — local hour at which the daily reflection fires.
   *  Default 21 (9 PM local) — late-evening reflection on the day. */
  hour?: number;
  /** 0-59 — local minute. Default 0. */
  minute?: number;
  /** Tick interval. Default 60_000 (1 minute). Tests pass smaller. */
  intervalMs?: number;
  /** Pure data sources for `buildDailyReflection`. */
  metrics?: DailyReflectionInput['metrics'];
  history?: DailyReflectionInput['history'];
  /** Hansei LLM polish. When omitted (or it throws), the push body
   *  uses the deterministic counts fallback. */
  polish?: DailyReflectionPolishCallable;
  /** Test seam — replace `notifyDailyReflection`. */
  notify?: typeof notifyDailyReflection;
  /** Test seam — wall-clock source. */
  now?: () => number;
  /** Test seam — replace `setInterval` / `clearInterval`. The
   *  handle type is intentionally `unknown` so the caller can
   *  return a number (browser-style) or NodeJS.Timeout
   *  (node-style) without us needing to bridge. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Test seam — start in fired state for given date so the next
   *  hour cross does NOT fire. Production callers leave undefined. */
  initialFiredDate?: string;
  /** Optional logger. Defaults to debug.log when enabled. */
  log?: (event: string, payload?: Record<string, unknown>) => void;
}

export interface DailyReflectionSchedulerHandle {
  /** Stop the scheduler. Idempotent. */
  stop(): void;
  /** Force-fire once · returns the snapshot used. Useful for tests
   *  + a future "send me my reflection now" command. */
  fireNow(): Promise<DailyReflectionSnapshot>;
  /** Diagnostic — date-key the scheduler last fired for. */
  lastFiredDate(): string | null;
}

/** Spawn a daily reflection scheduler. The returned handle can stop
 *  the loop or trigger an out-of-band fire. */
export function startDailyReflectionScheduler(
  opts: DailyReflectionSchedulerOpts = {},
): DailyReflectionSchedulerHandle {
  const hour = clampInt(opts.hour ?? 21, 0, 23);
  const minute = clampInt(opts.minute ?? 0, 0, 59);
  const intervalMs = Math.max(1_000, opts.intervalMs ?? 60_000);
  const now = opts.now ?? Date.now;
  const setIv: (fn: () => void, ms: number) => unknown =
    opts.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIv: (handle: unknown) => void =
    opts.clearInterval ?? ((handle) => {
      // Cast to satisfy both browser (number) + node (Timeout) shapes.
      globalThis.clearInterval(handle as Parameters<typeof globalThis.clearInterval>[0]);
    });
  const notify = opts.notify ?? notifyDailyReflection;
  const log = opts.log ?? ((event, payload) => {
    if (debug.enabled) debug.log('reflection.scheduler', event, payload ?? {});
  });

  let lastFiredDate: string | null = opts.initialFiredDate ?? null;
  let stopped = false;

  const buildSnapshotForToday = (): DailyReflectionSnapshot => {
    const today = dateKey(now());
    return buildDailyReflection({
      date: today,
      ...(opts.metrics ? { metrics: opts.metrics } : {}),
      ...(opts.history ? { history: opts.history } : {}),
      now,
    });
  };

  const fire = async (): Promise<DailyReflectionSnapshot> => {
    const snapshot = buildSnapshotForToday();
    let hanseiText: string | undefined;
    if (opts.polish) {
      try {
        const polished = await opts.polish({ snapshot });
        if (polished.trim().length > 0) hanseiText = polished;
      } catch (e) {
        log('polish-error', { date: snapshot.date, message: (e as Error).message ?? String(e) });
      }
    }
    try {
      await notify({ snapshot, ...(hanseiText ? { hanseiText } : {}) });
      log('fired', { date: snapshot.date, usedHansei: !!hanseiText });
    } catch (e) {
      log('notify-error', { date: snapshot.date, message: (e as Error).message ?? String(e) });
    }
    lastFiredDate = snapshot.date;
    return snapshot;
  };

  const tick = (): void => {
    if (stopped) return;
    const ms = now();
    const d = new Date(ms);
    const today = dateKey(ms);
    // Match local hour:minute (NOT UTC) — the user's day boundary is
    // wall-clock relative.
    if (d.getHours() !== hour) return;
    if (d.getMinutes() !== minute) return;
    if (lastFiredDate === today) return;
    void fire().catch((e) => log('tick-error', { message: (e as Error).message ?? String(e) }));
  };

  const handle = setIv(tick, intervalMs);
  // Boot log so daemon dogfood (`grep reflection.scheduler` in
  // log/debug-*.log) can immediately confirm wire-up. Caught one
  // gap during R4+ verification: scheduler was wired correctly but
  // logged nothing on construction → no easy way to confirm
  // `hasPolish=true` without waiting for fire/stop. One-shot,
  // gated by debug.enabled (the default log() arg).
  log('boot', { hour, minute, intervalMs, hasPolish: !!opts.polish });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try { clearIv(handle); } catch { /* swallow */ }
      log('stopped');
    },
    async fireNow() {
      return fire();
    },
    lastFiredDate() {
      return lastFiredDate;
    },
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const i = Math.trunc(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}
