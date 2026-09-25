// ── D (Phase 3 Bundle 2) — Push notification adapter ──
//
// Service Worker 와 Push API 를 추상화 — 모바일에서 monad 가 PFC
// reverse-feedback 등 비동기 이벤트 발생 시 OS native push 띄움. PWA
// 가 백그라운드인 상태에서도 사용자가 알림 받음.
//
// Pure adapter — Service Worker registration / Push subscription 흐름
// 을 단계별 helper 로 분리. host 가 각 helper 호출.

export interface PushPermissionResult {
  readonly state: 'granted' | 'denied' | 'default';
  /** 사용자가 거절한 경우 추가 안내 메시지 권장. */
  readonly canRetryLater: boolean;
}

export interface PushSubscriptionInfo {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushAdapterDeps {
  /** Web Push API VAPID public key — 서버가 발행. */
  readonly vapidPublicKey: string;
  /** Service Worker 스크립트 path. Default '/sw.js'. */
  readonly swScriptPath?: string;
  /** 구독 정보를 백엔드로 전송 — 푸시 발송 위해 server 가 저장. */
  readonly registerWithBackend: (info: PushSubscriptionInfo) => Promise<boolean>;
  /** 구독 해제 시 백엔드 알림. */
  readonly unregisterWithBackend?: (endpoint: string) => Promise<void>;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface PushAdapter {
  /** SW 등록 — 한 번만 호출 (PWA boot). */
  registerServiceWorker(): Promise<{ ok: boolean; reason?: string }>;
  /** 권한 요청 — 사용자 prompt. 명시적 사용자 action 필요 (PWA UX
   *  best practice — boot 시 자동 호출 X). */
  requestPermission(): Promise<PushPermissionResult>;
  /** 구독 — 권한 granted 후 호출. 백엔드에 endpoint 등록. */
  subscribe(): Promise<{ ok: boolean; subscription?: PushSubscriptionInfo; reason?: string }>;
  /** 구독 해제. */
  unsubscribe(): Promise<{ ok: boolean }>;
  /** 현재 구독 상태. */
  getSubscription(): Promise<PushSubscriptionInfo | null>;
}

interface PushNavigatorLike {
  serviceWorker?: {
    register: (path: string) => Promise<unknown>;
    ready: Promise<unknown>;
    getRegistration?: () => Promise<unknown>;
  };
}

interface PushNotificationLike {
  requestPermission: () => Promise<NotificationPermission>;
  permission: NotificationPermission;
}

interface PushSubscriptionResolved {
  endpoint: string;
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
}

interface PushManagerLike {
  subscribe(opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<PushSubscriptionResolved>;
  getSubscription(): Promise<PushSubscriptionResolved | null>;
}

interface ServiceWorkerRegistrationLike {
  pushManager: PushManagerLike;
}

/** Convert URL-safe base64 VAPID key → Uint8Array (Web Push API 요구). */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushAdapterRuntimeOpts {
  /** Test seam — inject globalThis.navigator surface. */
  readonly nav?: PushNavigatorLike;
  /** Test seam — inject Notification global. */
  readonly notification?: PushNotificationLike;
}

export function createPushAdapter(
  deps: PushAdapterDeps,
  opts: PushAdapterRuntimeOpts = {},
): PushAdapter {
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  const nav = opts.nav ?? (typeof navigator !== 'undefined' ? (navigator as PushNavigatorLike) : undefined);
  const notif = opts.notification ?? (typeof Notification !== 'undefined' ? Notification : undefined);
  const swPath = deps.swScriptPath ?? '/sw.js';

  const getReg = async (): Promise<ServiceWorkerRegistrationLike | null> => {
    if (!nav?.serviceWorker) return null;
    const reg = await nav.serviceWorker.ready;
    return reg as ServiceWorkerRegistrationLike;
  };

  return {
    async registerServiceWorker() {
      if (!nav?.serviceWorker) {
        log('pwa.push.no-sw', '');
        return { ok: false, reason: 'service-worker-unsupported' };
      }
      try {
        await nav.serviceWorker.register(swPath);
        log('pwa.push.sw-registered', swPath);
        return { ok: true };
      } catch (err) {
        log('pwa.push.sw-throw', '', { error: String(err) });
        return { ok: false, reason: String(err) };
      }
    },

    async requestPermission() {
      if (!notif) {
        return { state: 'denied', canRetryLater: false };
      }
      try {
        const result = await notif.requestPermission();
        log('pwa.push.permission', result);
        return {
          state: result as 'granted' | 'denied' | 'default',
          canRetryLater: result === 'default',
        };
      } catch (err) {
        log('pwa.push.permission-throw', '', { error: String(err) });
        return { state: 'denied', canRetryLater: false };
      }
    },

    async subscribe() {
      const reg = await getReg();
      if (!reg) return { ok: false, reason: 'no-service-worker' };
      try {
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(deps.vapidPublicKey),
        });
        const json = subscription.toJSON();
        const info: PushSubscriptionInfo = {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        };
        const ok = await deps.registerWithBackend(info);
        log('pwa.push.subscribed', '', { ok, endpoint: info.endpoint.slice(0, 60) });
        return ok ? { ok: true, subscription: info } : { ok: false, reason: 'backend-rejected' };
      } catch (err) {
        log('pwa.push.subscribe-throw', '', { error: String(err) });
        return { ok: false, reason: String(err) };
      }
    },

    async unsubscribe() {
      const reg = await getReg();
      if (!reg) return { ok: false };
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return { ok: true }; // already unsubscribed
      try {
        const json = sub.toJSON();
        if (deps.unregisterWithBackend) await deps.unregisterWithBackend(json.endpoint);
        // unsubscribe is on the actual PushSubscription, but our type
        // doesn't include it (we only need toJSON). Cast to any locally.
        await ((sub as unknown as { unsubscribe: () => Promise<void> }).unsubscribe());
        log('pwa.push.unsubscribed', '');
        return { ok: true };
      } catch (err) {
        log('pwa.push.unsubscribe-throw', '', { error: String(err) });
        return { ok: false };
      }
    },

    async getSubscription() {
      const reg = await getReg();
      if (!reg) return null;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return null;
      const json = sub.toJSON();
      return {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      };
    },
  };
}
