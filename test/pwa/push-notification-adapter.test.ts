// ── D (Phase 3 Bundle 2) — push-notification-adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  createPushAdapter,
  urlBase64ToUint8Array,
  type PushSubscriptionInfo,
} from '../../src/pwa/push-notification-adapter';

describe('urlBase64ToUint8Array', () => {
  test('decodes URL-safe base64', () => {
    const out = urlBase64ToUint8Array('AQID');  // base64 of [1,2,3]
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  test('handles padding', () => {
    const out = urlBase64ToUint8Array('AQ');  // padded to 'AQ=='
    expect(out.length).toBe(1);
    expect(out[0]).toBe(1);
  });

  test('replaces URL-safe chars - and _', () => {
    // base64 of Uint8Array([0xFF, 0xFE]) is "//4="
    // URL-safe of "//4=" is "__4="
    const std = urlBase64ToUint8Array('//4=');
    const safe = urlBase64ToUint8Array('__4');
    expect(Array.from(std)).toEqual(Array.from(safe));
  });
});

describe('createPushAdapter — happy paths (with mocked nav)', () => {
  function makeMockNav(opts: {
    swRegister?: (path: string) => Promise<unknown>;
    subscription?: PushSubscriptionInfo | null;
  } = {}) {
    let storedSub = opts.subscription ?? null;
    return {
      serviceWorker: {
        register: opts.swRegister ?? (async () => {}),
        ready: Promise.resolve({
          pushManager: {
            subscribe: async () => ({
              endpoint: 'https://push.example.com/abc',
              toJSON: () => ({
                endpoint: 'https://push.example.com/abc',
                keys: { p256dh: 'p1', auth: 'a1' },
              }),
            }),
            getSubscription: async () => storedSub
              ? { endpoint: storedSub.endpoint, toJSON: () => ({ endpoint: storedSub!.endpoint, keys: storedSub!.keys }) }
              : null,
          },
        }),
      },
    };
  }

  function makeMockNotif(perm: NotificationPermission) {
    return { permission: perm, requestPermission: async () => perm };
  }

  test('registerServiceWorker success', async () => {
    let registered = '';
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav({ swRegister: async (p) => { registered = p; } }) },
    );
    const r = await adapter.registerServiceWorker();
    expect(r.ok).toBe(true);
    expect(registered).toBe('/sw.js');
  });

  test('registerServiceWorker uses custom path', async () => {
    let registered = '';
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', swScriptPath: '/custom-sw.js', registerWithBackend: async () => true },
      { nav: makeMockNav({ swRegister: async (p) => { registered = p; } }) },
    );
    await adapter.registerServiceWorker();
    expect(registered).toBe('/custom-sw.js');
  });

  test('registerServiceWorker — no SW support', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: {} },
    );
    const r = await adapter.registerServiceWorker();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('service-worker-unsupported');
  });

  test('requestPermission granted', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav(), notification: makeMockNotif('granted') as unknown as Notification },
    );
    const r = await adapter.requestPermission();
    expect(r.state).toBe('granted');
    expect(r.canRetryLater).toBe(false);
  });

  test('requestPermission default → canRetryLater true', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav(), notification: makeMockNotif('default') as unknown as Notification },
    );
    const r = await adapter.requestPermission();
    expect(r.canRetryLater).toBe(true);
  });

  test('requestPermission — no Notification API → denied', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav() },
    );
    const r = await adapter.requestPermission();
    expect(r.state).toBe('denied');
    expect(r.canRetryLater).toBe(false);
  });

  test('subscribe success → backend registered', async () => {
    let backendCall: PushSubscriptionInfo | null = null;
    const adapter = createPushAdapter(
      {
        vapidPublicKey: 'AQID',
        registerWithBackend: async (info) => { backendCall = info; return true; },
      },
      { nav: makeMockNav() },
    );
    const r = await adapter.subscribe();
    expect(r.ok).toBe(true);
    expect(r.subscription?.endpoint).toBe('https://push.example.com/abc');
    expect(backendCall!.keys.p256dh).toBe('p1');
  });

  test('subscribe — backend rejects', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => false },
      { nav: makeMockNav() },
    );
    const r = await adapter.subscribe();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('backend-rejected');
  });

  test('getSubscription returns null when none', async () => {
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav() },
    );
    expect(await adapter.getSubscription()).toBeNull();
  });

  test('getSubscription returns existing', async () => {
    const sub: PushSubscriptionInfo = {
      endpoint: 'https://push.example.com/xyz',
      keys: { p256dh: 'pX', auth: 'aX' },
    };
    const adapter = createPushAdapter(
      { vapidPublicKey: 'AQID', registerWithBackend: async () => true },
      { nav: makeMockNav({ subscription: sub }) },
    );
    expect(await adapter.getSubscription()).toEqual(sub);
  });
});
