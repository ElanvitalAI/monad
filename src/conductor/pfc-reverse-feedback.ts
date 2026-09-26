// ── T1 (Phase 1) — PFC reverse-feedback orchestrator ──
//
// Receives `PfcShellDeathSignal` events from `pfc-shell-watcher`,
// fetches the settled `ShellResult`, runs `researchShellFailure`, and
// surfaces a notification to the user via the injected sink.
//
// Per HANDOFF §4.4 the orchestrator owns:
//   • False-positive filtering (classification === 'success' → skip)
//   • Race-window handling (await handle.result with timeout grace)
//   • Capability gating (canWrite=false → suggestion-only, no apply)
//   • Cancel semantics (user starts a new command → drop in-flight task)
//   • Concurrency (one in-flight task per shellId; new triggers cancel
//     the prior one for the same shell)

import {
  researchShellFailure,
  type ShellFailureResearchDeps,
  type ShellFailureResearchInput,
  type ShellFailureResearchResult,
} from '../auto-research/shell-failure-research.js';
import { deriveTerminalCapability } from '../terminal/posture.js';
import type { ShellHandle, ShellResult } from '../shell-runner/types.js';
import type { TerminalSurfaceCapability } from '../terminal/posture.js';
import type { PfcShellDeathSignal } from './pfc-shell-watcher.js';

// ── Public surface ────────────────────────────────────────────────

/**
 * Notification payload pushed to the dashboard / voice runtime / ACP
 * sink. JSON-clean per substrate G5 — every cross-host gateway can
 * mirror this without translation.
 */
export interface PfcReverseFeedbackNotification {
  readonly shellId: string;
  readonly summary: string;
  readonly research: ShellFailureResearchResult;
  /** When `true`, the shell's prior posture had `agentInteractive ===
   *  true && canWrite === true`; the dashboard may render an `[Apply]`
   *  action. When `false`, suggestion-only (HANDOFF §4.4 capability
   *  gate). */
  readonly canApply: boolean;
  /** Capability vector at the moment the death event fired. */
  readonly capability: TerminalSurfaceCapability;
}

export type PfcReverseFeedbackSink = (
  notification: PfcReverseFeedbackNotification,
) => void;

export interface PfcReverseFeedbackDeps {
  sink: PfcReverseFeedbackSink;
  research?: ShellFailureResearchDeps;
  /** When the watcher fires, we need the settled `ShellResult` to
   *  classify the failure. `handle.result` is a Promise that
   *  resolves on boundary; this option caps the wait so a wedged
   *  surface doesn't keep the orchestrator pending forever. Default
   *  4000 ms. */
  resultTimeoutMs?: number;
  /** Test seam — defaults to Date.now. */
  now?: () => number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Optional source for "what was the user trying to do" context.
   *  When provided, the latest call's return value flows into the
   *  research input (HANDOFF §4.5 — "유사 패턴" search benefits). */
  recentUserPrompt?: () => string | undefined;
}

export interface PfcReverseFeedback {
  /** Watcher dispatch entry. */
  start(signal: PfcShellDeathSignal): void;
  /** Cancel any in-flight task for `shellId`. Called when the user
   *  starts a new command or explicitly dismisses. */
  cancel(shellId: string): void;
  /** Diagnostic — list shellIds with in-flight research. */
  inFlight(): readonly string[];
}

// ── Implementation ────────────────────────────────────────────────

interface InFlightTask {
  readonly cancelled: { value: boolean };
  readonly startedAt: number;
}

const DEFAULT_RESULT_TIMEOUT = 4000;

async function awaitResult(
  handle: ShellHandle | null,
  timeoutMs: number,
): Promise<ShellResult | null> {
  if (!handle) return null;
  return new Promise<ShellResult | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    handle.result.then((res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function buildSummary(
  shellId: string,
  research: ShellFailureResearchResult,
  canApply: boolean,
): string {
  const { classification, candidates } = research;
  const shortId = shellId.length > 8 ? shellId.slice(0, 8) : shellId;
  const top = candidates[0];
  const exitFragment = classification.exitCode !== undefined
    ? ` (exit ${classification.exitCode})`
    : '';
  const headline = top
    ? `${top.label}`
    : `shell ${shortId} 종료 — 분석할 단서 없음`;
  const applyHint = canApply ? ' · [Apply] [Show diff]' : ' · 제안만 (canWrite=false)';
  return `🧠 elanous · sh-${shortId}${exitFragment} · ${headline}${applyHint}`;
}

export function createPfcReverseFeedback(
  deps: PfcReverseFeedbackDeps,
): PfcReverseFeedback {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, InFlightTask>();

  const cancel = (shellId: string): void => {
    const task = inflight.get(shellId);
    if (!task) return;
    task.cancelled.value = true;
    inflight.delete(shellId);
    if (deps.logDebug) {
      deps.logDebug('pfc.reverse-feedback.cancel', shellId, {
        ageMs: now() - task.startedAt,
      });
    }
  };

  const start = (signal: PfcShellDeathSignal): void => {
    // Cancel any prior task for this shell before starting a new one.
    if (inflight.has(signal.shellId)) cancel(signal.shellId);

    const cancelled = { value: false };
    const task: InFlightTask = { cancelled, startedAt: now() };
    inflight.set(signal.shellId, task);

    if (deps.logDebug) {
      deps.logDebug('pfc.reverse-feedback.start', signal.shellId, {
        prevExposure: signal.prev?.userExposure ?? null,
      });
    }

    void (async () => {
      try {
        const timeoutMs = deps.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT;
        const result = await awaitResult(signal.handle, timeoutMs);
        if (cancelled.value) {
          if (deps.logDebug) {
            deps.logDebug('pfc.reverse-feedback.cancelled-mid-await', signal.shellId);
          }
          return;
        }

        const input: ShellFailureResearchInput = {
          handle: signal.handle,
          result,
          recentUserPrompt: deps.recentUserPrompt?.(),
        };
        const research = await researchShellFailure(input, deps.research);
        if (cancelled.value) {
          if (deps.logDebug) {
            deps.logDebug('pfc.reverse-feedback.cancelled-post-research', signal.shellId);
          }
          return;
        }

        // Per HANDOFF §4.4 false-positive guard — never bother the
        // user when the shell exited cleanly or the classifier had
        // nothing to say. The watcher fires for *every* termination;
        // the orchestrator decides whether the user sees anything.
        if (
          research.classification.clazz === 'success' ||
          research.classification.clazz === 'unknown'
        ) {
          if (deps.logDebug) {
            deps.logDebug('pfc.reverse-feedback.skip-false-positive', signal.shellId, {
              clazz: research.classification.clazz,
            });
          }
          return;
        }

        // Capability gate — `prev` is the live posture (next is
        // `unavailable` by definition). canWrite + agentInteractive
        // determines whether [Apply] is ever offered.
        const capability = signal.prev
          ? deriveTerminalCapability(signal.prev)
          : { canRead: false, canInterrupt: false, canWrite: false, canInspect: false };
        const agentInteractive = signal.prev?.agentInteractive ?? false;
        const canApply = capability.canWrite && agentInteractive;

        const notification: PfcReverseFeedbackNotification = {
          shellId: signal.shellId,
          summary: buildSummary(signal.shellId, research, canApply),
          research,
          canApply,
          capability,
        };

        try {
          deps.sink(notification);
        } catch (err) {
          if (deps.logDebug) {
            deps.logDebug('pfc.reverse-feedback.sink-throw', signal.shellId, {
              error: String(err),
            });
          }
        }
      } finally {
        // Only remove the task if it's still ours — a later signal
        // for the same shell may have replaced it via cancel().
        const current = inflight.get(signal.shellId);
        if (current === task) inflight.delete(signal.shellId);
      }
    })();
  };

  return {
    start,
    cancel,
    inFlight() {
      return Array.from(inflight.keys());
    },
  };
}
