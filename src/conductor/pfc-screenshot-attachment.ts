// ── X4 (Phase 1 Bundle 2) — PFC auto-Screenshot attachment ──
//
// When T1 fires a death event for a vw / modal surface that we can
// resolve to a SurfaceAddress, snap a Screenshot at the moment of
// classification and attach it to the notification. Downstream
// research proposers (LLM with vision) can use this as an additional
// research input.
//
// HANDOFF §5 X4: "T1 trigger 시 자동 Screenshot({paneId, format:'png'})
// 호출. 결과 PNG 를 PFC research input 으로 첨부. metadata (posture +
// recentIntents) 첨부 (X2 와 결합)".
//
// We keep this layer thin and side-effect-isolated: the attacher
// receives a notification and an optional screenshot dispatcher;
// returns a new notification with `attachments` populated. The
// actual research-proposer integration (vision LLM consuming the
// attachment) lands in Bundle 3 (X7) — this file just makes the
// bytes available.

import type { PfcReverseFeedbackNotification } from './pfc-reverse-feedback.js';

export interface PfcScreenshotAttachment {
  readonly kind: 'screenshot-png';
  /** Surface that was captured. JSON-clean for ACP / Discord mirror. */
  readonly surfaceId: string;
  /** Base64 PNG body. */
  readonly bodyBase64: string;
  /** Capture wall-clock for de-dup / staleness checks. */
  readonly capturedAt: number;
  /** Optional human-readable note (size, dims). */
  readonly note?: string;
}

export interface PfcScreenshotAttacherDeps {
  /** Resolves the captured surface for a given shellId. Returns null
   *  when the shell isn't currently mounted on a screenshot-capable
   *  surface (bg / inline). */
  resolveScreenshotTarget?: (shellId: string) => null | {
    surfaceId: string;
    /** Args passed to `dispatchScreenshot`. The simplest path is
     *  `{ windowId, paneId, format: 'png' }`; richer callers may
     *  provide a `target: SurfaceAddress`. */
    args: Record<string, unknown>;
  };
  /** Inject the actual screenshot dispatcher (avoid hard import to
   *  keep this file dep-free + testable). Typically wired to
   *  `dispatchScreenshot` from `src/capture/capture-tools.ts`. */
  dispatchScreenshot?: (args: Record<string, unknown>) => Promise<{
    bodyBase64?: string;
    bytes?: number;
    note?: string;
  }>;
  /** Cap on capture wall-clock — over budget abandons the attachment
   *  and proceeds with chat / voice as normal. Default 1500 ms.
   *  Per HANDOFF §6 latency budget V1 is 1.5s end-to-end; capture
   *  must fit a similar window. */
  budgetMs?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Test seam — defaults to Date.now. */
  now?: () => number;
}

export interface PfcScreenshotAttacher {
  /** Augment a notification with a screenshot attachment when the
   *  surface resolves and capture succeeds inside the budget. Returns
   *  the (possibly augmented) notification. Always preserves all
   *  original fields. */
  attach(
    notification: PfcReverseFeedbackNotification,
  ): Promise<PfcReverseFeedbackNotification & { attachments?: readonly PfcScreenshotAttachment[] }>;
}

const DEFAULT_BUDGET_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

export function createPfcScreenshotAttacher(
  deps: PfcScreenshotAttacherDeps,
): PfcScreenshotAttacher {
  const now = deps.now ?? Date.now;
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return {
    async attach(notification) {
      if (!deps.resolveScreenshotTarget || !deps.dispatchScreenshot) {
        return notification;
      }
      const target = deps.resolveScreenshotTarget(notification.shellId);
      if (!target) {
        if (deps.logDebug) {
          deps.logDebug('pfc.screenshot.no-target', notification.shellId);
        }
        return notification;
      }

      const result = await withTimeout(
        deps.dispatchScreenshot({ ...target.args, format: 'png' }),
        budget,
      );
      if (!result) {
        if (deps.logDebug) {
          deps.logDebug('pfc.screenshot.timeout', notification.shellId, { budgetMs: budget });
        }
        return notification;
      }
      if (!result.bodyBase64) {
        if (deps.logDebug) {
          deps.logDebug('pfc.screenshot.no-body', notification.shellId);
        }
        return notification;
      }

      const attachment: PfcScreenshotAttachment = {
        kind: 'screenshot-png',
        surfaceId: target.surfaceId,
        bodyBase64: result.bodyBase64,
        capturedAt: now(),
        ...(result.note ? { note: result.note } : {}),
      };

      if (deps.logDebug) {
        deps.logDebug('pfc.screenshot.attached', notification.shellId, {
          surfaceId: target.surfaceId,
          bytes: result.bytes ?? 0,
        });
      }

      return {
        ...notification,
        attachments: [attachment],
      };
    },
  };
}
