// RFC #2161 FU A8 — discovery cron schedule via NEXUS daemon.
//
// Wires `runDiscovery` to a setInterval loop that fires inside the
// long-running NEXUS daemon. Default = opt-in: the loop only starts
// when `registry.discovery.cron.intervalMs` (or legacy env
// `MONAD_DISCOVERY_CRON_INTERVAL_MS`) is set to a positive integer
// (so a fresh install pays zero CPU/network for nothing).
//
// User-config wiring (2026-05-11 retroactive fix · memory
// `feedback_user_config_over_env.md`): the canonical entrypoint is
// `getDiscoveryCronConfig()` from `./config.js`, which prefers user-
// config and falls back to the legacy env var for backward compat.
//
// Boot flow (in `src/nexus/index.ts`):
//   const discoveryCron = startDiscoveryCron();
//   // ... daemon runs ...
//   discoveryCron?.stop();
//
// The first tick fires immediately (lateness 0 across daemon
// restarts), then every `intervalMs`. Each tick is wrapped in a
// try/catch so a single failed run can't kill the loop. The handle
// exposes `triggerNow()` for tests + future ops endpoints that want
// to force a refresh.
//
// Cross-ref:
//   src/registry/discovery/runner.ts (runDiscovery)
//   src/registry/discovery/s3-push.ts (push pipeline · runs implicitly)
//   src/nexus/index.ts (boot wiring)

import { getDiscoveryCronConfig } from './config.js';
import { runDiscovery } from './runner.js';
import type { DiscoverySnapshot, RunDiscoveryOpts } from './runner.js';

export interface DiscoveryCronHandle {
  /** Stop the loop. Idempotent — second call is no-op. */
  stop(): void;
  /** Fire one tick immediately, independent of the interval timer.
   *  Useful for ops endpoints / tests. Resolves once the tick
   *  completes (or fails) — the loop continues regardless. */
  triggerNow(): Promise<DiscoverySnapshot | null>;
  /** Effective interval (ms). 0 means "loop not started" (opt-out). */
  intervalMs: number;
}

export interface StartDiscoveryCronOpts {
  /** Override the interval. When 0/undefined and the env is also
   *  unset, the cron stays dormant. */
  intervalMs?: number;
  /** Test seam — replace the run function. Defaults to runDiscovery. */
  runFn?: (opts?: RunDiscoveryOpts) => Promise<{
    snapshot: DiscoverySnapshot;
  } | null>;
  /** Test seam — pass runDiscovery options through (e.g. fake
   *  sources, disabled S3 push). */
  runOpts?: RunDiscoveryOpts;
  /** Test seam — replace setTimeout/setInterval timing primitives. */
  setTimer?: typeof setInterval;
  clearTimer?: typeof clearInterval;
  /** Test seam — control "fire first tick immediately" semantics.
   *  Default true (matches production). */
  fireImmediately?: boolean;
  /** Optional callback after every successful tick. Production uses
   *  it for telemetry; tests assert call sequencing. */
  onTick?: (result: { ok: boolean; snapshot?: DiscoverySnapshot; error?: string }) => void;
}

const MIN_INTERVAL_MS = 60_000;   // 1 minute — protect against typo'd env
const MAX_INTERVAL_MS = 86_400_000; // 24 hours — anything beyond is "manual"

/** Read the cron interval from the env. Returns 0 when unset / out of
 *  range / not an integer (cron stays dormant).
 *
 *  Note: This function reads the legacy env directly and bypasses user-
 *  config. Production callers should prefer `getDiscoveryCronConfig()`
 *  (`./config.ts`) which respects the user-config > env priority. This
 *  helper is preserved for tests that specifically exercise env clamping
 *  in isolation. */
export function readCronIntervalMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MONAD_DISCOVERY_CRON_INTERVAL_MS?.trim() ?? '';
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed < MIN_INTERVAL_MS) return MIN_INTERVAL_MS;
  if (parsed > MAX_INTERVAL_MS) return MAX_INTERVAL_MS;
  return parsed;
}

/** Start the discovery cron loop. When `intervalMs` resolves to 0
 *  the function returns a dormant handle (`stop()` no-op,
 *  `triggerNow()` still works for one-shot calls). */
export function startDiscoveryCron(
  opts: StartDiscoveryCronOpts = {},
): DiscoveryCronHandle {
  // Resolution order: explicit opts.intervalMs > user-config >
  // legacy env (`MONAD_DISCOVERY_CRON_INTERVAL_MS`) > 0 (dormant).
  // `getDiscoveryCronConfig()` already handles user-config + env
  // fallback + clamp; we just pass the resolved value through.
  const intervalMs = opts.intervalMs ?? getDiscoveryCronConfig().intervalMs;
  const runFn = opts.runFn
    ?? (async (runOpts) => runDiscovery(runOpts));
  const setTimer = opts.setTimer ?? setInterval;
  const clearTimer = opts.clearTimer ?? clearInterval;
  const fireImmediately = opts.fireImmediately ?? true;

  const tick = async (): Promise<DiscoverySnapshot | null> => {
    try {
      const result = await runFn(opts.runOpts);
      const snapshot = result?.snapshot ?? null;
      opts.onTick?.({
        ok: true,
        ...(snapshot ? { snapshot } : {}),
      });
      return snapshot;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      opts.onTick?.({ ok: false, error });
      return null;
    }
  };

  if (intervalMs <= 0) {
    // Dormant — the handle's `triggerNow()` still works (for ops
    // endpoints + tests) but no scheduled loop runs.
    return {
      intervalMs: 0,
      stop: () => { /* no-op */ },
      triggerNow: () => tick(),
    };
  }

  if (fireImmediately) {
    // Fire-and-forget — the daemon doesn't await; subsequent ticks
    // proceed even if this one is still in flight (runs are pure /
    // idempotent per the snapshot contract).
    void tick();
  }
  const timer = setTimer(() => { void tick(); }, intervalMs);

  let stopped = false;
  return {
    intervalMs,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { clearTimer(timer); } catch { /* ignore */ }
    },
    triggerNow: () => tick(),
  };
}
