// ── V5 watchdog + completion notification ──
//
// Subscribes to the registry's V4 event bus and:
//
//   1. **Stall detection** — tracks the last output timestamp for each
//      live PTY. When `stallMs` passes with no output on an alive
//      handle, emits one `stalled` event (debounced; reset only when
//      output arrives or the PTY exits).
//
//   2. **Completion notifications** — receives `exit` events from the
//      bus and forwards them to subscribed consumers (dashboard chat-
//      log, toast, Pushcut, …) via `onPtyCompletion(cb)`. Keeps the
//      presentation layer out of this module.
//
// Design mirrors claude-code's LocalShellTask stall watchdog (5s tick,
// growth-check against the persisted-output file) but fits elanous's
// event-driven registry — no file, just timestamps.
//
// Reference: DESIGN-background-terminal-port.md §5 V5.

import {
  onPtyEvent, emitPtyEvent, listPty, getPty,
} from './registry.js';

export interface WatchdogOpts {
  /** Interval in ms between stall checks. Default 5000. */
  tickMs?: number;
  /** Silent duration in ms before a running PTY is reported stalled.
   *  Default 60000. */
  stallMs?: number;
}

export interface PtyCompletion {
  id: string;
  exitCode: number | null;
  signal?: number;
  /** Total wall clock from spawn to exit (ms). */
  durationMs: number;
  /** true when the watchdog never saw a `stalled` event for this id
   *  — i.e. it was producing output up to the exit. */
  stalledBefore: boolean;
}

type CompletionListener = (info: PtyCompletion) => void;

/** In-module state so the watchdog survives across imports — callers
 *  use `startPtyWatchdog(opts)` to get a disposer. */
interface Tracker {
  id: string;
  lastOutputAt: number;
  startedAt: number;
  stalledEmitted: boolean;
}

const trackers = new Map<string, Tracker>();
const completionListeners = new Set<CompletionListener>();
let active: {
  unsub: () => void;
  timer: ReturnType<typeof setInterval>;
  stallMs: number;
} | null = null;

/** Subscribe to PTY completion events (one per exit). The callback is
 *  invoked AFTER the registry's `exit` event fires, so `getPty(id)`
 *  may return undefined already (if detach=false + killNonDetached
 *  path). Returns an unsubscribe function. */
export function onPtyCompletion(cb: CompletionListener): () => void {
  completionListeners.add(cb);
  return () => { completionListeners.delete(cb); };
}

/** Start the watchdog. Returns a disposer that stops the timer and
 *  drops its registry subscription. Safe to call multiple times —
 *  successive calls reset the opts but reuse the tracker state so the
 *  watchdog never loses "last output" timestamps mid-session. */
export function startPtyWatchdog(opts: WatchdogOpts = {}): () => void {
  const tickMs = opts.tickMs ?? 5000;
  const stallMs = opts.stallMs ?? 60000;
  stopPtyWatchdog();

  // Seed trackers for any live PTYs already in the registry (so we
  // don't miss a `spawned` event that fired before the watchdog
  // booted). Treat their startedAt as the last output point.
  const now = Date.now();
  for (const h of listPty()) {
    if (!h.isAlive()) continue;
    if (!trackers.has(h.id)) {
      trackers.set(h.id, {
        id: h.id,
        startedAt: h.startedAt,
        lastOutputAt: h.startedAt,
        stalledEmitted: false,
      });
    }
  }

  const unsub = onPtyEvent((ev) => {
    switch (ev.type) {
      case 'spawned': {
        const h = getPty(ev.id);
        const startedAt = h?.startedAt ?? Date.now();
        trackers.set(ev.id, {
          id: ev.id,
          startedAt,
          lastOutputAt: startedAt,
          stalledEmitted: false,
        });
        return;
      }
      case 'output': {
        const t = trackers.get(ev.id);
        if (t) {
          t.lastOutputAt = Date.now();
          t.stalledEmitted = false; // output came back — clear stall debounce
        }
        return;
      }
      case 'exit': {
        const t = trackers.get(ev.id);
        const info: PtyCompletion = {
          id: ev.id,
          exitCode: ev.exitCode,
          signal: ev.signal,
          durationMs: t ? Date.now() - t.startedAt : 0,
          stalledBefore: t?.stalledEmitted ?? false,
        };
        for (const cb of completionListeners) {
          try { cb(info); } catch { /* swallow */ }
        }
        trackers.delete(ev.id);
        return;
      }
      case 'unregistered': {
        trackers.delete(ev.id);
        return;
      }
      // 'stalled' comes FROM us; nothing to do.
      default: return;
    }
  });

  const timer = setInterval(() => {
    const tnow = Date.now();
    for (const t of trackers.values()) {
      if (t.stalledEmitted) continue;
      const h = getPty(t.id);
      if (!h || !h.isAlive()) continue;
      const silentMs = tnow - t.lastOutputAt;
      if (silentMs >= stallMs) {
        t.stalledEmitted = true;
        emitPtyEvent({ type: 'stalled', id: t.id, silentMs });
      }
    }
  }, tickMs);
  // Don't keep the event loop alive just for the watchdog — let it
  // idle out with the rest of the process.
  const t = timer as unknown as { unref?: () => void };
  if (typeof t.unref === 'function') t.unref();

  active = { unsub, timer, stallMs };
  return () => stopPtyWatchdog();
}

/** Stop the watchdog (idempotent). Does NOT clear completionListeners —
 *  those are process-scoped. */
export function stopPtyWatchdog(): void {
  if (!active) return;
  try { active.unsub(); } catch { /* ignore */ }
  try { clearInterval(active.timer); } catch { /* ignore */ }
  active = null;
}

/** Test helper: true if the watchdog is currently running. */
export function isPtyWatchdogActive(): boolean {
  return active !== null;
}

/** Test helper: reset all watchdog state (trackers + completion
 *  listeners + timer). Not meant for production use. */
export function resetPtyWatchdogForTesting(): void {
  stopPtyWatchdog();
  trackers.clear();
  completionListeners.clear();
}

/** Human-readable summary for a completion — used by the dashboard
 *  chat-log hook and by any CLI that wants a one-liner. Exported so
 *  tests can lock in the exact wording.
 *
 *  Shape:
 *    ⚡ pty_abc123 exited (code 0) after 12s
 *    ⚡ pty_abc123 exited (signal SIGTERM) after 12s — was stalled
 */
export function formatPtyCompletion(info: PtyCompletion): string {
  const secs = Math.max(0, Math.round(info.durationMs / 1000));
  const age = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${secs % 60}s`;
  const reason = info.signal
    ? `signal ${signalName(info.signal)}`
    : info.exitCode !== null
      ? `code ${info.exitCode}`
      : 'unknown';
  const stallSuffix = info.stalledBefore ? ' — was stalled' : '';
  return `⚡ ${info.id} exited (${reason}) after ${age}${stallSuffix}`;
}

function signalName(sig: number): string {
  // Just the handful we expect from kill; anything else → the number.
  switch (sig) {
    case 1:  return 'SIGHUP';
    case 2:  return 'SIGINT';
    case 9:  return 'SIGKILL';
    case 15: return 'SIGTERM';
    default: return String(sig);
  }
}
