// ACP H3 #6 — Push notification dispatcher for background sessions.
//
// Subscribes to BackgroundManager state changes and fires Pushcut
// (iPhone) notifications on the transitions that matter to a user
// away from the terminal:
//
//   running → waiting_for_confirmation  → "agent needs approval"
//   running → completed                  → "agent done"
//   running → failed                     → "agent failed"
//   running → cancelled                  → (silent · user initiated)
//
// Pushcut gracefully degrades when unconfigured (returns
// `{ ok: false, reason: 'pushcut-not-configured' }`); we fall back
// to an optional `logFallback` sink (e.g. wire to debug log or a
// Telegram text channel).
//
// The notifier is a one-shot object: create it at dashboard startup,
// call `dispose()` at shutdown. Multiple notifiers on the same
// manager would fire duplicate pushes — don't do that.

import type { BackgroundManager, BackgroundSessionRecord } from './background-manager.js';
import type { PushcutClient, PushcutSendResult } from '../pushcut/client.js';
import { debug } from '../debug/log.js';

export interface BackgroundNotifierOpts {
  manager?: BackgroundManager;
  pushcut?: PushcutClient;
  /** Optional text-sink fallback when Pushcut isn't configured.
   *  Receives a human-readable string. Wire to Telegram/Discord/log. */
  logFallback?: (msg: string) => void;
  /** Pushcut notification name (must appear in the allowlist on the
   *  Pushcut app side). Default 'monad-background-agent'. */
  notificationName?: string;
  /** Max chars of outputPreview echoed into the push body. Default 120. */
  bodyCap?: number;
}

export interface BackgroundNotifier {
  /** Unsubscribe from the manager. Idempotent. */
  dispose(): void;
}

const DEFAULT_NOTIFICATION_NAME = 'monad-background-agent';
const DEFAULT_BODY_CAP = 120;

function cappedBody(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1) + '…';
}

function titleFor(record: BackgroundSessionRecord): string | null {
  switch (record.state) {
    case 'waiting_for_confirmation':
      return `${record.backendId} needs your approval`;
    case 'completed':
      return `${record.backendId} finished`;
    case 'failed':
      return `${record.backendId} failed`;
    case 'cancelled':
      // User-initiated cancel — no push.
      return null;
    case 'running':
      // Transient return-to-running (after approval resolved) — no push.
      return null;
  }
}

function bodyFor(record: BackgroundSessionRecord, cap: number): string {
  const lead = record.initialMessage.length > 60
    ? record.initialMessage.slice(0, 59) + '…'
    : record.initialMessage;
  if (record.state === 'failed' && record.error) {
    return cappedBody(`[${lead}] ${record.error}`, cap);
  }
  const preview = record.outputPreview || '(no output)';
  return cappedBody(`[${lead}] ${preview}`, cap);
}

export function createBackgroundNotifier(
  opts: BackgroundNotifierOpts = {},
): BackgroundNotifier {
  const manager = opts.manager ?? (() => {
    // Lazy import avoids a circular dependency at module-load time.
    // Callers that don't supply a manager get the global singleton.
    throw new Error('BackgroundNotifier requires `manager` opt');
  })();

  // Resolve dependencies lazily inside the listener so a caller can
  // wire notifier before Pushcut is initialised (dashboard startup
  // order is fluid).
  const getPushcut = (): PushcutClient | null => {
    if (opts.pushcut) return opts.pushcut;
    return null;
  };

  const name = opts.notificationName ?? DEFAULT_NOTIFICATION_NAME;
  const bodyCap = opts.bodyCap ?? DEFAULT_BODY_CAP;

  const unsubscribe = manager.onStateChange((record) => {
    const title = titleFor(record);
    if (title === null) return; // cancelled / transient → no push

    const body = bodyFor(record, bodyCap);
    const pushcut = getPushcut();
    const logFallback = opts.logFallback;

    if (pushcut && pushcut.configured) {
      pushcut
        .notify(name, { title, text: body })
        .then((result: PushcutSendResult) => {
          if (!result.ok && debug.enabled) {
            debug.log('acp.bg.pushcut-fail', record.id, {
              reason: result.reason,
            }, { level: 'error' });
          }
          if (!result.ok && logFallback) {
            logFallback(`[${title}] ${body}`);
          }
        })
        .catch((err) => {
          if (debug.enabled) {
            debug.log('acp.bg.pushcut-throw', record.id, {
              message: (err as Error)?.message,
            });
          }
          if (logFallback) logFallback(`[${title}] ${body}`);
        });
      return;
    }

    // No Pushcut — fall back to log sink.
    if (logFallback) {
      logFallback(`[${title}] ${body}`);
    }
  });

  return {
    dispose() {
      unsubscribe();
    },
  };
}
