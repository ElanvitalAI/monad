// CV-3 mobile-readiness #1 follow-up · IntentPanel collapsed
// preference storage tests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  getIntentPanelCollapsed,
  getIntentPanelDisplayMode,
  setIntentPanelCollapsed,
  setIntentPanelDisplayMode,
  subscribeIntentPanelCollapsed,
  subscribeIntentPanelDisplayMode,
  type IntentPanelDisplayMode,
} from './intent-panel-storage';

// bun test runs in a Node-ish env without a DOM, so `window` is
// undefined by default. Polyfill the surface our storage shim
// touches: `window.localStorage` (Map-backed) +
// `window.addEventListener` / dispatchEvent (subscribers).
let originalWindow: unknown;
let listeners: Array<(e: StorageEvent) => void>;

beforeAll(() => {
  originalWindow = (globalThis as { window?: unknown }).window;
  const store = new Map<string, string>();
  listeners = [];
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    addEventListener: (kind: string, cb: (e: StorageEvent) => void) => {
      if (kind === 'storage') listeners.push(cb);
    },
    removeEventListener: (kind: string, cb: (e: StorageEvent) => void) => {
      if (kind !== 'storage') return;
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatchEvent: (ev: StorageEvent) => {
      for (const l of [...listeners]) l(ev);
      return true;
    },
  };
  // Polyfill StorageEvent constructor so `new StorageEvent(...)` works.
  (globalThis as { StorageEvent?: unknown }).StorageEvent = class {
    key: string | null = null;
    newValue: string | null = null;
    constructor(public type: string, init: { key?: string; newValue?: string | null } = {}) {
      this.key = init.key ?? null;
      this.newValue = init.newValue ?? null;
    }
  };
});

afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
  delete (globalThis as { StorageEvent?: unknown }).StorageEvent;
});

describe('intent-panel-storage', () => {
  beforeEach(() => {
    (globalThis as { window?: { localStorage: { clear: () => void } } }).window?.localStorage.clear();
    listeners.length = 0;
  });

  afterEach(() => {
    (globalThis as { window?: { localStorage: { clear: () => void } } }).window?.localStorage.clear();
    listeners.length = 0;
  });

  test('getIntentPanelCollapsed default = false', () => {
    expect(getIntentPanelCollapsed()).toBe(false);
  });

  test('setIntentPanelCollapsed(true) → true', () => {
    setIntentPanelCollapsed(true);
    expect(getIntentPanelCollapsed()).toBe(true);
  });

  test('setIntentPanelCollapsed(false) clears storage (default state)', () => {
    setIntentPanelCollapsed(true);
    setIntentPanelCollapsed(false);
    expect(getIntentPanelCollapsed()).toBe(false);
    if (typeof window !== 'undefined') {
      expect(window.localStorage.getItem('monad.showroom.intentPanel.collapsed')).toBeNull();
    }
  });

  test('subscribe fires on storage event', () => {
    if (typeof window === 'undefined') return; // SSR — no-op
    const events: boolean[] = [];
    const off = subscribeIntentPanelCollapsed((v) => events.push(v));
    setIntentPanelCollapsed(true);
    setIntentPanelCollapsed(false);
    expect(events).toContain(true);
    expect(events).toContain(false);
    off();
  });

  test('subscribe ignores unrelated storage events', () => {
    if (typeof window === 'undefined') return;
    const events: boolean[] = [];
    const off = subscribeIntentPanelCollapsed((v) => events.push(v));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'some.other.key',
      newValue: 'true',
    }));
    expect(events).toHaveLength(0);
    off();
  });

  test('subscribe returns unsubscribe that stops further callbacks', () => {
    if (typeof window === 'undefined') return;
    const events: boolean[] = [];
    const off = subscribeIntentPanelCollapsed((v) => events.push(v));
    off();
    setIntentPanelCollapsed(true);
    expect(events).toHaveLength(0);
  });
});

describe('intent-panel-storage · displayMode', () => {
  beforeEach(() => {
    (globalThis as { window?: { localStorage: { clear: () => void } } }).window?.localStorage.clear();
    listeners.length = 0;
  });

  afterEach(() => {
    (globalThis as { window?: { localStorage: { clear: () => void } } }).window?.localStorage.clear();
    listeners.length = 0;
  });

  test('getIntentPanelDisplayMode default = fixed', () => {
    expect(getIntentPanelDisplayMode()).toBe('fixed');
  });

  test('setIntentPanelDisplayMode round-trips popup', () => {
    setIntentPanelDisplayMode('popup');
    expect(getIntentPanelDisplayMode()).toBe('popup');
  });

  test('setIntentPanelDisplayMode round-trips off', () => {
    setIntentPanelDisplayMode('off');
    expect(getIntentPanelDisplayMode()).toBe('off');
  });

  test('setIntentPanelDisplayMode("fixed") clears storage (default state)', () => {
    setIntentPanelDisplayMode('popup');
    setIntentPanelDisplayMode('fixed');
    expect(getIntentPanelDisplayMode()).toBe('fixed');
    if (typeof window !== 'undefined') {
      expect(window.localStorage.getItem('monad.showroom.intentPanel.displayMode')).toBeNull();
    }
  });

  test('unknown stored value falls back to fixed', () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('monad.showroom.intentPanel.displayMode', 'whatever');
    expect(getIntentPanelDisplayMode()).toBe('fixed');
  });

  test('subscribe fires on displayMode storage event', () => {
    if (typeof window === 'undefined') return;
    const events: IntentPanelDisplayMode[] = [];
    const off = subscribeIntentPanelDisplayMode((m) => events.push(m));
    setIntentPanelDisplayMode('popup');
    setIntentPanelDisplayMode('off');
    setIntentPanelDisplayMode('fixed');
    expect(events).toEqual(['popup', 'off', 'fixed']);
    off();
  });

  test('subscribe ignores unrelated keys', () => {
    if (typeof window === 'undefined') return;
    const events: IntentPanelDisplayMode[] = [];
    const off = subscribeIntentPanelDisplayMode((m) => events.push(m));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'monad.showroom.intentPanel.collapsed',
      newValue: 'true',
    }));
    expect(events).toHaveLength(0);
    off();
  });

  test('displayMode and collapsed flags are independent', () => {
    setIntentPanelCollapsed(true);
    setIntentPanelDisplayMode('popup');
    expect(getIntentPanelCollapsed()).toBe(true);
    expect(getIntentPanelDisplayMode()).toBe('popup');
    setIntentPanelDisplayMode('fixed');
    // displayMode reset to default but collapsed stays
    expect(getIntentPanelCollapsed()).toBe(true);
    expect(getIntentPanelDisplayMode()).toBe('fixed');
  });
});
