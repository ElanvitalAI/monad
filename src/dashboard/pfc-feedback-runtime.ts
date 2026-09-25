// ── T1 (Phase 1) — Dashboard PFC feedback runtime ──
//
// Boot helper that wires the substrate `ShellRegistry` posture stream
// to the orchestrator (`pfc-reverse-feedback`) and renders the
// resulting notification as a chat-line. Mirrors the small-runtime
// pattern used by `chord-feedback-runtime.ts` so the dashboard boot
// adds at most ~3 lines.
//
// Per HANDOFF §4.1 the visible artifact is a one-line muted banner
// in the chat log. `[Apply]` / `[Show diff]` are exposed as labels
// for now; wiring real apply actions belongs to a follow-up arc that
// can reuse the assistant action-block infrastructure.

import {
  createPfcReverseFeedback,
  type PfcReverseFeedback,
  type PfcReverseFeedbackNotification,
} from '../conductor/pfc-reverse-feedback.js';
import {
  createPfcShellWatcher,
  type PfcShellWatcher,
} from '../conductor/pfc-shell-watcher.js';
import type { ShellRegistry } from '../shell-runner/types.js';
import type { ShellFailureResearchDeps } from '../auto-research/shell-failure-research.js';

export interface DashboardPfcFeedbackRuntimeDeps {
  registry: ShellRegistry;
  /** Push a chat-line into the dashboard chat log. The dashboard's
   *  existing `pushMutedLine` callback works here. */
  pushChatLine: (line: string) => void;
  /** Optional voice / external sink (used by V1 in Bundle 2). */
  onNotification?: (notification: PfcReverseFeedbackNotification) => void;
  /** Optional research proposers (LLM / git-log). Default: heuristic
   *  only — V1 / X4 inject richer proposers. */
  research?: ShellFailureResearchDeps;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Off-switch — when `false`, the runtime skips registry
   *  subscription entirely. Default `true` (HANDOFF §4.6 backout
   *  surfaces this via `pfc.reverseFeedback` user-config). */
  enabled?: boolean;
  /** Optional last-prompt accessor — flows into research input as
   *  `recentUserPrompt`. */
  recentUserPrompt?: () => string | undefined;
}

export interface DashboardPfcFeedbackRuntime {
  readonly enabled: boolean;
  /** Cancel any in-flight reverse-feedback for the given shell. The
   *  dashboard calls this when the user fires a new command in the
   *  same surface (HANDOFF §4.4 cancel rule). */
  cancel(shellId: string): void;
  /** Inflight diagnostic. */
  inFlight(): readonly string[];
  /** Stop posture subscription. Idempotent. */
  stop(): void;
  /** Internal handles — exposed for tests + V1 voice runtime which
   *  needs to attach a second sink. */
  readonly orchestrator: PfcReverseFeedback;
  readonly watcher: PfcShellWatcher | null;
}

const DISABLED_HANDLE: PfcReverseFeedback = {
  start: () => { /* no-op */ },
  cancel: () => { /* no-op */ },
  inFlight: () => [],
};

export function createDashboardPfcFeedbackRuntime(
  deps: DashboardPfcFeedbackRuntimeDeps,
): DashboardPfcFeedbackRuntime {
  const enabled = deps.enabled !== false;
  if (!enabled) {
    return {
      enabled: false,
      cancel: () => { /* no-op */ },
      inFlight: () => [],
      stop: () => { /* no-op */ },
      orchestrator: DISABLED_HANDLE,
      watcher: null,
    };
  }

  const orchestrator = createPfcReverseFeedback({
    sink: (notification) => {
      try { deps.pushChatLine(notification.summary); } catch { /* isolate */ }
      try { deps.onNotification?.(notification); } catch { /* isolate */ }
    },
    research: deps.research,
    logDebug: deps.logDebug,
    recentUserPrompt: deps.recentUserPrompt,
  });

  const watcher = createPfcShellWatcher({
    registry: deps.registry,
    onDeath: (signal) => orchestrator.start(signal),
    logDebug: deps.logDebug,
  });

  return {
    enabled: true,
    cancel: (shellId) => orchestrator.cancel(shellId),
    inFlight: () => orchestrator.inFlight(),
    stop: () => watcher.stop(),
    orchestrator,
    watcher,
  };
}
