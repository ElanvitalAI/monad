// PR-D (PWA surface picker · 2026-05-13) — localStorage-backed
// surface-kind preference. Tests mirror daemon-session.test.ts's
// `withFakeWindow` pattern so the same harness handles
// localStorage + window event listeners without DOM.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  SURFACE_PREFERENCE_KEY,
  getSurfacePreference,
  setSurfacePreference,
  subscribeSurfacePreference,
  type SurfacePreference,
} from './surface-preference';

interface FakeWindowEnv {
  store: Record<string, string>;
  emitStorage: (key: string, newValue: string | null) => void;
  restore: () => void;
}

function withFakeWindow(): FakeWindowEnv {
  const store: Record<string, string> = {};
  const listeners = new Set<(ev: StorageEvent) => void>();
  const fakeStorage = {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  const realWindow = (globalThis as { window?: unknown }).window;
  const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const fakeWindow = {
    localStorage: fakeStorage,
    addEventListener: (event: string, cb: unknown) => {
      if (event === 'storage') listeners.add(cb as (ev: StorageEvent) => void);
    },
    removeEventListener: (event: string, cb: unknown) => {
      if (event === 'storage') listeners.delete(cb as (ev: StorageEvent) => void);
    },
  };
  (globalThis as { window?: unknown }).window = fakeWindow;
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  return {
    store,
    emitStorage: (key, newValue) => {
      const ev = { key, newValue } as StorageEvent;
      for (const l of listeners) l(ev);
    },
    restore: () => {
      (globalThis as { window?: unknown }).window = realWindow;
      (globalThis as { localStorage?: unknown }).localStorage = realLocalStorage;
    },
  };
}

describe('surface-preference', () => {
  let env: FakeWindowEnv;

  beforeEach(() => {
    env = withFakeWindow();
  });
  afterEach(() => {
    env.restore();
  });

  test('getSurfacePreference returns null when nothing is stored', () => {
    expect(getSurfacePreference()).toBeNull();
  });

  test('getSurfacePreference returns null for stale unknown values', () => {
    env.store[SURFACE_PREFERENCE_KEY] = 'legacy-kind';
    expect(getSurfacePreference()).toBeNull();
  });

  test.each(['none', 'readonly', 'chat', 'webterm'] as const)(
    'getSurfacePreference round-trips %s through setSurfacePreference',
    (kind) => {
      expect(setSurfacePreference(kind)).toBe(true);
      expect(env.store[SURFACE_PREFERENCE_KEY]).toBe(kind);
      expect(getSurfacePreference()).toBe(kind);
    },
  );

  test('setSurfacePreference(null) clears the stored entry', () => {
    env.store[SURFACE_PREFERENCE_KEY] = 'chat';
    expect(setSurfacePreference(null)).toBe(true);
    expect(SURFACE_PREFERENCE_KEY in env.store).toBe(false);
    expect(getSurfacePreference()).toBeNull();
  });

  test('subscribeSurfacePreference fires for same-tab setSurfacePreference', () => {
    const seen: SurfacePreference[] = [];
    const off = subscribeSurfacePreference((v) => seen.push(v));
    setSurfacePreference('readonly');
    setSurfacePreference('webterm');
    setSurfacePreference(null);
    off();
    expect(seen).toEqual(['readonly', 'webterm', null]);
  });

  test('subscribeSurfacePreference fires for cross-tab storage events', () => {
    const seen: SurfacePreference[] = [];
    const off = subscribeSurfacePreference((v) => seen.push(v));
    // Simulate another tab writing the key.
    env.emitStorage(SURFACE_PREFERENCE_KEY, 'chat');
    env.emitStorage(SURFACE_PREFERENCE_KEY, null);
    env.emitStorage(SURFACE_PREFERENCE_KEY, 'bogus-kind'); // stale → null
    env.emitStorage('unrelated-key', 'ignored');
    off();
    expect(seen).toEqual(['chat', null, null]);
  });

  test('subscribeSurfacePreference unsubscribe stops both same-tab and cross-tab fanout', () => {
    const seen: SurfacePreference[] = [];
    const off = subscribeSurfacePreference((v) => seen.push(v));
    off();
    setSurfacePreference('chat');
    env.emitStorage(SURFACE_PREFERENCE_KEY, 'readonly');
    expect(seen).toEqual([]);
  });
});
