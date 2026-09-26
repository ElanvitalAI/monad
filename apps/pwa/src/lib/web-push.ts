// Service Worker Phase 3 — PWA-side push subscribe helpers.
//
// Three operations:
//   1. enableNotifications() — request browser permission · fetch
//      VAPID public key from daemon · subscribe via SW · POST the
//      subscription to /v1/push/subscribe so daemon stores it.
//   2. disableNotifications() — read cached id from localStorage,
//      DELETE /v1/push/subscribe/<id>, unsubscribe locally.
//   3. getSubscriptionStatus() — synchronous best-effort check so
//      Settings UI can render the right toggle state on mount.
//
// Why localStorage for the id (not server lookup): the daemon could
// be reached over WAN where round-trips are expensive; the id is
// only useful for one operation (DELETE) and the consequences of
// drift are tiny — at worst the user sees the wrong toggle state
// once, which `enableNotifications()` re-confirms via 200/409.
//
// VAPID key format: web-push library returns a base64url-encoded
// uncompressed P-256 public key. PushManager.subscribe wants a raw
// Uint8Array of the same key — we convert here.

import { debugLog } from './debug';

const SUBSCRIPTION_ID_KEY = 'elanous.pwa.pushSubscriptionId';
const SUBSCRIPTION_LABEL_KEY = 'elanous.pwa.pushSubscriptionLabel';

export type EnableOutcome =
  | { status: 'enabled'; id: string }
  | { status: 'permission-denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string };

export type DisableOutcome =
  | { status: 'disabled' }
  | { status: 'not-subscribed' }
  | { status: 'error'; reason: string };

export interface NotificationStatus {
  supported: boolean;
  permission: NotificationPermission | 'unknown';
  cachedId: string | null;
  cachedLabel: string | null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Browser's PushManager.subscribe() wants a raw byte array.
  // web-push returns base64url; convert via standard base64.
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    out[i] = rawData.charCodeAt(i);
  }
  return out;
}

export function getNotificationStatus(): NotificationStatus {
  const supported =
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  let cachedId: string | null = null;
  let cachedLabel: string | null = null;
  try {
    cachedId = window.localStorage.getItem(SUBSCRIPTION_ID_KEY);
    cachedLabel = window.localStorage.getItem(SUBSCRIPTION_LABEL_KEY);
  } catch { /* swallow — private mode etc. */ }
  return {
    supported,
    permission: supported ? Notification.permission : 'unknown',
    cachedId,
    cachedLabel,
  };
}

export interface EnableOpts {
  baseUrl: string;
  token?: string;
  /** Friendly label saved alongside the subscription so Settings
   *  UI can show "iPhone 15" instead of an opaque endpoint URL.
   *  Defaults to "${platform} ${date}" when undefined. */
  label?: string;
}

export async function enableNotifications(opts: EnableOpts): Promise<EnableOutcome> {
  if (typeof window === 'undefined') {
    return { status: 'unsupported', reason: 'no window' };
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { status: 'unsupported', reason: 'Notification/PushManager API absent' };
  }
  if (!opts.baseUrl) {
    return { status: 'error', reason: 'daemon baseUrl not configured' };
  }

  // Permission first — Notification.requestPermission() prompts the
  // user. Must run from a user gesture (button click) on iOS Safari.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    debugLog('pwa.push.permission-denied');
    return { status: 'permission-denied' };
  }

  // Fetch VAPID public key. Public endpoint — no auth.
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  let publicKey: string;
  try {
    const res = await fetch(`${baseUrl}/v1/push/vapid-public-key`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { publicKey?: string };
    if (!body.publicKey) throw new Error('missing publicKey in response');
    publicKey = body.publicKey;
  } catch (e) {
    return { status: 'error', reason: `vapid fetch: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Subscribe via the SW registration. The SW has been registered
  // by ServiceWorkerRegister at app boot (Phase 1).
  const reg = await navigator.serviceWorker.ready;
  let subscription: PushSubscription;
  try {
    // Cast through BufferSource — recent TS lib.dom narrows this
    // type to ArrayBufferView<ArrayBuffer> which Uint8Array<ArrayBufferLike>
    // doesn't satisfy. Browsers accept the Uint8Array directly so the
    // narrowing is over-strict.
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  } catch (e) {
    return { status: 'error', reason: `subscribe: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Push the subscription to daemon so it persists.
  const subJson = subscription.toJSON();
  const label = opts.label
    ?? `${navigator.userAgent.split(' ')[0] ?? 'browser'} ${new Date().toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(`${baseUrl}/v1/push/subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify({ subscription: subJson, label }),
    });
    if (!res.ok) {
      const detail = await res.text();
      try { await subscription.unsubscribe(); } catch { /* swallow */ }
      return { status: 'error', reason: `subscribe POST: ${res.status} ${detail.slice(0, 200)}` };
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) {
      try { await subscription.unsubscribe(); } catch { /* swallow */ }
      return { status: 'error', reason: 'daemon did not return subscription id' };
    }
    try {
      window.localStorage.setItem(SUBSCRIPTION_ID_KEY, body.id);
      window.localStorage.setItem(SUBSCRIPTION_LABEL_KEY, label);
    } catch { /* swallow */ }
    debugLog('pwa.push.enabled', { id: body.id, label });
    return { status: 'enabled', id: body.id };
  } catch (e) {
    try { await subscription.unsubscribe(); } catch { /* swallow */ }
    return { status: 'error', reason: e instanceof Error ? e.message : String(e) };
  }
}

export interface DisableOpts {
  baseUrl: string;
  token?: string;
}

export async function disableNotifications(opts: DisableOpts): Promise<DisableOutcome> {
  if (typeof window === 'undefined') {
    return { status: 'error', reason: 'no window' };
  }
  let id: string | null = null;
  try { id = window.localStorage.getItem(SUBSCRIPTION_ID_KEY); } catch { /* swallow */ }
  if (!id) {
    return { status: 'not-subscribed' };
  }
  // Best-effort unsubscribe locally — even if the daemon DELETE fails,
  // we want to stop receiving pushes on this client.
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    }
  } catch { /* swallow */ }

  if (opts.baseUrl) {
    try {
      await fetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/push/subscribe/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        ...(opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : {}),
      });
    } catch (e) {
      debugLog('pwa.push.disable.daemon-failed', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    window.localStorage.removeItem(SUBSCRIPTION_ID_KEY);
    window.localStorage.removeItem(SUBSCRIPTION_LABEL_KEY);
  } catch { /* swallow */ }
  return { status: 'disabled' };
}
