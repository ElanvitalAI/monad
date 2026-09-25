// ── T1 (Phase 1) — PFC Shell Watcher ──
//
// Subscribes to `ShellRegistry.subscribePosture` and forwards "shell
// death" events into the PFC reverse-feedback orchestrator.
//
// Per HANDOFF §4.2 (T1 entry detail) the canonical wire is:
//
//   ShellRegistry
//     .subscribePosture((event) => {
//       if (postureDeath(event)) pfc.start({ shellId, prev, next });
//     });
//
// "Death" is defined as a posture transition where `prev.userExposure`
// was not `'unavailable'` and `next.userExposure === 'unavailable'`.
// That covers all completion / kill paths for vw / modal / bg surfaces
// without coupling to ShellStatus internals.
//
// Per HANDOFF §4.4 (edge cases) we filter false positives at the
// orchestrator boundary, not here — the watcher's only job is to map
// substrate posture events to a "candidate" trigger. Filtering
// (exit code · stderr pattern · grep-style success) lives in
// `pfc-reverse-feedback.ts` so that this file stays a pure substrate
// adapter.

import type {
  ShellHandle,
  ShellPostureEvent,
  ShellRegistry,
  Unsubscribe,
} from '../shell-runner/types.js';

export interface PfcShellDeathSignal {
  readonly shellId: string;
  readonly prev: ShellPostureEvent['prev'];
  readonly next: ShellPostureEvent['next'];
  /** Live registry handle — orchestrator awaits `handle.result` for
   *  exit code + stdout/stderr. May be `null` if the handle was
   *  unregistered between posture emit and watcher dispatch. */
  readonly handle: ShellHandle | null;
  /** Wall-clock timestamp the watcher observed the transition. */
  readonly observedAt: number;
}

export type PfcShellDeathListener = (signal: PfcShellDeathSignal) => void;

export interface PfcShellWatcherDeps {
  registry: ShellRegistry;
  onDeath: PfcShellDeathListener;
  /** Optional debug hook — runtime owns the actual debug instance to
   *  avoid coupling this module to a global. Mirrors the pattern used
   *  by terminal-intent consumers. */
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Test seam — defaults to `Date.now`. */
  now?: () => number;
}

export interface PfcShellWatcher {
  /** Returns true if the event represents a posture-death transition.
   *  Exposed for testability — the dispatch loop uses this internally. */
  postureDeath(event: ShellPostureEvent): boolean;
  /** Stop subscribing. Idempotent. */
  stop(): void;
}

/** Substrate Layer 1 vocabulary — `'unavailable'` is the canonical
 *  end-of-life exposure (see `src/terminal/posture.ts` G7 contract). */
const TERMINATED: 'unavailable' = 'unavailable';

export function postureDeath(event: ShellPostureEvent): boolean {
  // No transition into `unavailable` means the shell is still live —
  // ignore (status flips between user-interactive ↔ observe-only ↔
  // hidden are not death events).
  if (!event.next || event.next.userExposure !== TERMINATED) return false;
  // First-emit case (prev null) — registry has no prior snapshot.
  // Surface attached and immediately reported `unavailable`. We don't
  // treat that as a death because the orchestrator has nothing to
  // analyze (no transition baseline) and many bg/inline first-emits
  // race ahead of the actual completion event.
  if (!event.prev) return false;
  return event.prev.userExposure !== TERMINATED;
}

export function createPfcShellWatcher(deps: PfcShellWatcherDeps): PfcShellWatcher {
  const now = deps.now ?? Date.now;
  let unsubscribe: Unsubscribe | null = null;

  const dispatch = (event: ShellPostureEvent): void => {
    if (!postureDeath(event)) {
      if (deps.logDebug) {
        deps.logDebug('pfc.shell-watcher.skip', event.shellId, {
          prev: event.prev?.userExposure ?? null,
          next: event.next?.userExposure ?? null,
        });
      }
      return;
    }
    const handle = deps.registry.get(event.shellId);
    if (deps.logDebug) {
      deps.logDebug('pfc.shell-watcher.death', event.shellId, {
        hasHandle: handle !== null,
        prev: event.prev?.userExposure ?? null,
      });
    }
    try {
      deps.onDeath({
        shellId: event.shellId,
        prev: event.prev,
        next: event.next,
        handle,
        observedAt: now(),
      });
    } catch (err) {
      // Isolate listener throws — substrate subscribers must not
      // bubble exceptions back into the registry emit loop.
      if (deps.logDebug) {
        deps.logDebug('pfc.shell-watcher.listener-throw', event.shellId, {
          error: String(err),
        });
      }
    }
  };

  unsubscribe = deps.registry.subscribePosture(dispatch);

  return {
    postureDeath,
    stop() {
      if (unsubscribe) {
        try { unsubscribe(); } catch { /* idempotent */ }
        unsubscribe = null;
      }
    },
  };
}
