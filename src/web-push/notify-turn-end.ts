// Service Worker Phase 3 — agent turn-end push trigger.
//
// Wired from the daemon's two turn-completion hook sites:
//   - REST  /v1/prompt   → src/boot/daemon-prompt-turn.ts (after runCoreTurn returns)
//   - ACP WS runTurn     → src/boot/daemon-runtime.ts createDaemonRunTurn onTurnComplete
//
// Fires `sendPushToAll` so any subscribed PWA client (iPad on home screen,
// PWA tab in background) gets a "your agent finished" notification. Push
// failure must NEVER propagate — the turn already succeeded, so we
// swallow + debug-log and return.

import { debug } from '../debug/log.js';
import { listSubscriptions } from './subscriptions.js';
import { sendPushToAll, type PushAction } from './sender.js';
import { INTENT_BUTTON_LABELS } from '../intent-prediction/types.js';

const BODY_MAX = 140;

/** R3 (BACKLOG #5) — 5 inline action buttons mirroring the
 *  IntentPanel's canonical labels. Tapping forwards to the
 *  `/v1/notification-action` endpoint via the SW; recorded as an
 *  intent-prediction feedback tap (recency boost) so the panel
 *  reflects the choice when the user opens the PWA. The full ACP
 *  loopback (action → next agent prompt without opening the PWA) is
 *  v2 work — v1 records the user's intent so the next session
 *  interaction picks it up.
 *
 *  Web Push action ids must be plain ASCII to round-trip safely
 *  through the SW; we use a simple slug and resolve back to the
 *  Korean label server-side via INTENT_BUTTON_LABELS lookup. */
const TURN_END_ACTIONS: readonly PushAction[] = INTENT_BUTTON_LABELS.map((label, idx) => ({
  action: `intent-${idx}`,
  title: label,
}));

function truncate(s: string, n: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= n) return trimmed;
  return `${trimmed.slice(0, n - 1)}…`;
}

/** Fire a Web Push notification announcing that the daemon finished an
 *  agent turn for `sessionId`. No-op when there are zero subscribers,
 *  the turn was aborted, or there's no assistant text to surface. */
export async function notifyAgentTurnEnd(opts: {
  sessionId: string;
  finalText: string;
  stopReason?: string;
}): Promise<void> {
  const { sessionId, finalText, stopReason } = opts;
  if (stopReason === 'aborted') return;
  const trimmed = finalText.trim();
  if (trimmed.length === 0) return;
  // Avoid the VAPID-load + iteration overhead when nobody is listening.
  if (listSubscriptions().length === 0) return;
  try {
    const result = await sendPushToAll({
      title: 'monad — agent done',
      body: truncate(trimmed, BODY_MAX),
      url: `/app/?session=${encodeURIComponent(sessionId)}`,
      tag: `agent-turn-${sessionId}`,
      data: { kind: 'agent-turn-end', sessionId },
      // Send the full 5 actions on every turn-end push (Chrome shows
      // up to 2-3 inline depending on device · the rest are stored
      // and accessed via long-press · still wired correctly even
      // when truncated). Safari ignores entirely → falls back to
      // body click → navigates to the session.
      actions: [...TURN_END_ACTIONS],
    });
    if (debug.enabled) {
      debug.log('webpush.notify', 'agent-turn-end', {
        sessionId,
        delivered: result.delivered,
        attempted: result.attempted,
        removed: result.removed,
        errorCount: result.errors.length,
      });
    }
  } catch (e) {
    if (debug.enabled) {
      debug.log('webpush.notify', 'agent-turn-end.error', {
        sessionId,
        message: (e as { message?: string })?.message ?? String(e),
      }, { level: 'error' });
    }
  }
}
