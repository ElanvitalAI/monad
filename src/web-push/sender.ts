// Service Worker Phase 3 — push notification sender.
//
// Wraps the `web-push` library's `sendNotification()` so callers
// (daemon turn-end hook · multi-device activity broadcaster · etc.)
// don't reach into the Web Push protocol directly. Each call:
//   - Loads the VAPID keypair (cached after first boot)
//   - Iterates the subscription list (or one targeted record)
//   - Calls `webpush.sendNotification(sub, payload, opts)` per record
//   - Handles 410 Gone / 404 Not Found by removing the subscription
//
// The notification payload is small JSON the SW decodes inside its
// `push` event handler. Keep `data` <= 4 KB (browser-imposed cap).

import * as webpushModule from 'web-push';
import { debug } from '../debug/log.js';
import {
  listSubscriptions,
  removeSubscription,
  type PushSubscriptionRecord,
} from './subscriptions.js';
import { loadVapidKeyPair } from './vapid-keys.js';

const webpush = (webpushModule as unknown as { default?: typeof webpushModule }).default
  ?? webpushModule;

/** R3 (mobile-readiness BACKLOG #5) — declarative action button on
 *  the system notification. Web Push spec accepts up to 5 entries
 *  (Chrome) — clicking one fires `notificationclick` with
 *  `event.action === <action>`. The SW (apps/pwa/public/sw.js) maps
 *  the click to a fire-and-forget POST to `/v1/notification-action`.
 *
 *  Note: Safari's PWA support landed in iOS 16.4+ but ignores the
 *  `actions` array — taps only fire the body click, with no per-
 *  action discriminator. Falling back to body-click navigation is
 *  the right behavior. */
export interface PushAction {
  /** Stable identifier — what `event.action` will read back as. */
  action: string;
  /** Localized label shown on the button. */
  title: string;
}

export interface PushPayload {
  /** Notification title shown to the user. Keep short (<60 chars). */
  title: string;
  /** Body text under the title. */
  body?: string;
  /** Optional URL to open when the user taps the notification.
   *  Resolved relative to the PWA's scope (`/app/`). */
  url?: string;
  /** Optional tag — same-tag notifications coalesce in OS UIs. */
  tag?: string;
  /** Free-form data the SW push handler hands to client postMessage
   *  if no notification action is taken. */
  data?: Record<string, unknown>;
  /** R3 — up to 5 inline action buttons (Chrome cap; Safari ignores). */
  actions?: PushAction[];
}

export interface SendPushResult {
  attempted: number;
  delivered: number;
  removed: number;
  errors: { id: string; reason: string }[];
}

let vapidConfigured = false;

async function ensureVapidConfigured(): Promise<void> {
  if (vapidConfigured) return;
  const keys = await loadVapidKeyPair();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  vapidConfigured = true;
}

async function sendOne(
  record: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<{ ok: boolean; remove: boolean; reason?: string }> {
  try {
    await webpush.sendNotification(
      record.subscription,
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }, // 24h — drop unread instead of stockpiling.
    );
    return { ok: true, remove: false };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    const status = err?.statusCode;
    // 410 Gone / 404 Not Found = subscription is dead. Drop it so
    // we stop wasting cycles on every notify.
    const remove = status === 410 || status === 404;
    return {
      ok: false,
      remove,
      reason: `${status ?? '?'} ${err?.message ?? err?.body ?? 'unknown'}`,
    };
  }
}

/** Send one notification to every active subscription. Returns a
 *  summary so the caller (e.g. agent-turn hook) can log + decide
 *  whether to surface a UI error when delivery is degraded. */
export async function sendPushToAll(payload: PushPayload): Promise<SendPushResult> {
  await ensureVapidConfigured();
  const subs = listSubscriptions();
  const result: SendPushResult = {
    attempted: subs.length,
    delivered: 0,
    removed: 0,
    errors: [],
  };
  for (const record of subs) {
    const r = await sendOne(record, payload);
    if (r.ok) {
      result.delivered += 1;
    } else {
      result.errors.push({ id: record.id, reason: r.reason ?? 'unknown' });
      if (r.remove) {
        if (removeSubscription(record.id)) result.removed += 1;
      }
    }
  }
  if (debug.enabled) {
    debug.log('webpush.send', 'all', {
      attempted: result.attempted,
      delivered: result.delivered,
      removed: result.removed,
      errorCount: result.errors.length,
    });
  }
  return result;
}

/** Reset the VAPID-configured flag — test seam. Production callers
 *  never invoke this. */
export function _resetSenderState(): void {
  vapidConfigured = false;
}
