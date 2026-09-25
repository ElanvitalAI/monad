// NEXUS · supervisor restart-with-backoff (Phase N-2 PR ε)
//
// Schedules tab restarts after crash / unhealthy events. Logic per
// PLAN §4.3:
//   1. halt-pattern hit → stay 'crashed' (no restart, emit tab.halt)
//   2. rolling 1h window of restartCount → if >= maxPerHour, halt
//   3. otherwise pick backoffMs[min(restartCount, len-1)] + jitter,
//      then setTimeout → stop tab → start tab again
//
// PR ε ships the *scheduling* layer — the actual `stop` / `start`
// callbacks are injected by the supervisor wiring (kind-aware: daemon
// uses spawn primitive, chat is view-only and never restarts, etc.).
// Tests pass synchronous mocks to drive the timer without real spawns.

import type { TabRegistry } from '../state/tab-registry.js';
import type { NexusState } from '../state/state.js';
import { pushEvent } from '../state/state.js';
import { debug } from '../../debug/log.js';

export interface RestartCallbacks {
  /** Fully stop the tab's child (kill + dispose). May resolve after grace. */
  stop(tabId: string, opts: { graceMs: number }): Promise<void>;
  /** Spawn the tab again; resolves once pid is assigned. */
  start(tabId: string): Promise<void>;
}

export interface ScheduleRestartOpts {
  state: NexusState;
  registry: TabRegistry;
  tabId: string;
  /** Last error string (stderr line / exit reason) — fed to halt-pattern test. */
  lastError?: string;
  callbacks: RestartCallbacks;
  /** Defaults to setTimeout — tests inject a controllable scheduler. */
  setTimer?: (cb: () => void, delayMs: number) => () => void;
  /** Defaults to Math.random — tests pin to 0 for deterministic delay. */
  random?: () => number;
}

export interface ScheduleRestartResult {
  outcome: 'halted-pattern' | 'halted-max' | 'scheduled' | 'never';
  delayMs?: number;
  matchedPattern?: string;
  /** Cancel the pending timer (no-op for halted outcomes). */
  cancel?: () => void;
}

const ROLLING_WINDOW_MS = 3_600_000;

export function maybeScheduleRestart(opts: ScheduleRestartOpts): ScheduleRestartResult {
  const tab = opts.registry.get(opts.tabId);
  if (!tab) throw new Error(`maybeScheduleRestart: tab not found: ${opts.tabId}`);
  const policy = tab.spec.restart;
  if (!policy || policy.policy === 'never') {
    return { outcome: 'never' };
  }

  // 1. halt-pattern detection (lastError fed by spawn/exit layers)
  if (opts.lastError && policy.haltPatterns?.length) {
    for (const pat of policy.haltPatterns) {
      try {
        if (new RegExp(pat).test(opts.lastError)) {
          opts.registry.patch(opts.tabId, { status: 'crashed', lastError: opts.lastError });
          pushEvent(opts.state, {
            kind: 'tab.halt',
            tabId: opts.tabId,
            detail: { reason: 'halt-pattern', pattern: pat, error: opts.lastError },
          });
          if (debug.enabled) {
            debug.log('nexus.supervisor.halt', opts.tabId, { pattern: pat });
          }
          return { outcome: 'halted-pattern', matchedPattern: pat };
        }
      } catch { /* invalid regex — skip */ }
    }
  }

  // 2. rolling window check
  const now = Date.now();
  let count = tab.restartCount;
  let windowStart = tab.restartCountWindowStart;
  if (now - windowStart > ROLLING_WINDOW_MS) {
    count = 0;
    windowStart = now;
  }
  if (count >= policy.maxPerHour) {
    opts.registry.patch(opts.tabId, {
      status: 'crashed',
      restartCount: count,
      restartCountWindowStart: windowStart,
      ...(opts.lastError !== undefined ? { lastError: opts.lastError } : {}),
    });
    pushEvent(opts.state, {
      kind: 'tab.halt',
      tabId: opts.tabId,
      detail: { reason: 'max-restart-per-hour', count, maxPerHour: policy.maxPerHour },
    });
    if (debug.enabled) {
      debug.log('nexus.supervisor.halt', opts.tabId, { reason: 'max-per-hour', count });
    }
    return { outcome: 'halted-max' };
  }

  // 3. backoff pick
  const idx = Math.min(count, policy.backoffMs.length - 1);
  const base = policy.backoffMs[idx] ?? 0;
  const random = opts.random ?? Math.random;
  const jitter = Math.floor(random() * 200);
  const delayMs = base + jitter;
  const newCount = count + 1;

  opts.registry.patch(opts.tabId, {
    status: 'restarting',
    restartCount: newCount,
    restartCountWindowStart: windowStart,
    ...(opts.lastError !== undefined ? { lastError: opts.lastError } : {}),
  });
  pushEvent(opts.state, {
    kind: 'tab.restart',
    tabId: opts.tabId,
    detail: { delayMs, count: newCount },
  });
  if (debug.enabled) {
    debug.log('nexus.supervisor.restart', opts.tabId, { delayMs, count: newCount });
  }

  const timer = opts.setTimer ?? ((cb, ms) => {
    const id = setTimeout(cb, ms);
    return () => clearTimeout(id);
  });
  let cancelled = false;
  const cancel = timer(() => {
    if (cancelled) return;
    void (async () => {
      try {
        await opts.callbacks.stop(opts.tabId, { graceMs: policy.graceMs ?? 2000 });
        if (cancelled) return;
        await opts.callbacks.start(opts.tabId);
      } catch (err) {
        if (debug.enabled) {
          debug.log('nexus.supervisor.restart.error', opts.tabId, { msg: String(err) }, { level: 'error' });
        }
      }
    })();
  }, delayMs);

  return {
    outcome: 'scheduled',
    delayMs,
    cancel: () => { cancelled = true; cancel(); },
  };
}
