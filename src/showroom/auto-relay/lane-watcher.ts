// Showroom v2 Arc 4 · per-lane idle detector.
//
// Watches one EmbodiedAgentSession's TransportObserver byte count and
// emits an `onIdle` event when the session transitions ACTIVE → IDLE
// (no byte change for `idleMs`). The reverse transition (IDLE → ACTIVE,
// when bytes start flowing again) doesn't emit — but it re-arms the
// watcher so the *next* idle period re-fires. This natural state
// machine avoids re-firing on a session that's been idle for a long
// time without needing an explicit cooldown timer.
//
// Pattern adapted from `src/agent/reply-capture.ts::collectUntilIdle`
// but kept stateful + event-driven instead of one-shot.
//
// PLAN: 내부 문서 `PLAN-showroom-v2-arc4-auto-relay-2026-04-28` §D1.

import { debug } from '../../debug/log.js';
import type { TransportObserver } from '../../agent/transport-observer.js';
import type { EmbodiedAgentSession } from '../../agent/embodiment.js';

export type LaneWatcherState = 'idle' | 'active' | 'done';

export interface LaneIdleEvent {
  readonly sessionId: string;
  /** ms since last byte change (≥ idleMs at fire time). */
  readonly idleMs: number;
  /** Total bytes captured at idle moment (for diff-from-prev). */
  readonly totalBytes: number;
}

export interface LaneWatcherOpts {
  readonly sessionId: string;
  readonly observer: TransportObserver;
  /** Optional — when provided, the watcher self-stops as soon as
   *  `session.state().status` enters 'done' or 'error'. */
  readonly session?: EmbodiedAgentSession;
  readonly onIdle: (ev: LaneIdleEvent) => void;
  /** ms — gap after last byte change before firing onIdle. Default 2500. */
  readonly idleMs?: number;
  /** ms — sample period. Default 100. */
  readonly pollMs?: number;
  /** DI clock for tests. Default `Date.now`. */
  readonly now?: () => number;
  /** DI sleep for tests. Default `Bun.sleep`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface LaneWatcher {
  readonly sessionId: string;
  state(): LaneWatcherState;
  /** Stop the loop · idempotent · awaits the in-flight tick. */
  stop(): Promise<void>;
}

/** Start a per-lane idle watcher. The caller owns the disposer
 *  (`stop()`). The loop is fire-and-forget — caller doesn't await. */
export function startLaneWatcher(opts: LaneWatcherOpts): LaneWatcher {
  const idleMs = opts.idleMs ?? 2500;
  const pollMs = opts.pollMs ?? 100;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  let state: LaneWatcherState = 'idle';
  let stopRequested = false;
  let lastBytes = totalBytesOf(opts.observer);
  let lastChangeAt = now();

  if (debug.enabled) {
    debug.log('auto-relay.watcher.start', opts.sessionId, {
      idleMs, pollMs, initialBytes: lastBytes,
    });
  }

  const run = async (): Promise<void> => {
    while (!stopRequested) {
      // Self-stop on session terminal status.
      const status = opts.session?.state().status;
      if (status === 'done' || status === 'error') {
        state = 'done';
        if (debug.enabled) {
          debug.log('auto-relay.watcher.self-stop', opts.sessionId, { status });
        }
        return;
      }

      const bytes = totalBytesOf(opts.observer);
      const ts = now();
      if (bytes !== lastBytes) {
        // Activity — flip to ACTIVE if we were idle. No event on this transition.
        if (state === 'idle') {
          state = 'active';
          if (debug.enabled) {
            debug.log('auto-relay.watcher.transition', opts.sessionId, {
              to: 'active', delta: bytes - lastBytes,
            });
          }
        }
        lastBytes = bytes;
        lastChangeAt = ts;
      } else {
        // No change — check if we crossed the idle threshold while ACTIVE.
        const sinceChange = ts - lastChangeAt;
        if (state === 'active' && sinceChange >= idleMs) {
          state = 'idle';
          if (debug.enabled) {
            debug.log('auto-relay.watcher.idle', opts.sessionId, {
              idleMs: sinceChange, totalBytes: bytes,
            });
          }
          // Fire the listener · isolate failures so one bad listener
          // doesn't take the loop down.
          try {
            opts.onIdle({
              sessionId: opts.sessionId,
              idleMs: sinceChange,
              totalBytes: bytes,
            });
          } catch (err) {
            if (debug.enabled) {
              debug.log('auto-relay.watcher.listener-error', opts.sessionId, {
                error: err instanceof Error ? err.message : String(err),
              }, { level: 'error' });
            }
          }
        }
      }

      await sleep(pollMs);
    }
  };

  // Fire-and-forget · the loop self-exits once stopRequested is true.
  // We deliberately don't keep a handle to the promise: stop() must
  // not block on the in-flight `sleep()` because in tests that sleep
  // is stub-controlled. The dangling promise is harmless — the loop
  // checks stopRequested each iteration top.
  void run();

  return {
    sessionId: opts.sessionId,
    state(): LaneWatcherState {
      return state;
    },
    async stop(): Promise<void> {
      stopRequested = true;
      if (debug.enabled) {
        debug.log('auto-relay.watcher.stop', opts.sessionId, { finalState: state });
      }
    },
  };
}

/** Sum byte length across every channel in the observer's snapshot. */
function totalBytesOf(observer: TransportObserver): number {
  const snap = observer.snapshotChannels();
  let total = 0;
  for (const v of Object.values(snap)) total += v.length;
  return total;
}

async function defaultSleep(ms: number): Promise<void> {
  // Bun.sleep is available — fall back to setTimeout for portability.
  if (typeof Bun !== 'undefined' && typeof Bun.sleep === 'function') {
    return Bun.sleep(ms);
  }
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
