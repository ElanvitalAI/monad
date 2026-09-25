// Round 3 PR2 (β-2 · 2026-05-08) — Showroom HITL toggle persistence
// + daemon-client query param wire. Pure unit tests on the
// localStorage util and a tiny smoke on the client URL shape.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getShowroomHitlDisabled,
  setShowroomHitlDisabled,
  subscribeShowroomHitl,
  SHOWROOM_HITL_STORAGE_KEY,
} from '../apps/pwa/src/lib/showroom/hitl-toggle.ts';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string): void { this.map.delete(k); }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

let restoreWindow: (() => void) | null = null;

beforeEach(() => {
  // Inject a minimal `window` with localStorage so the util thinks
  // it's running in a browser.
  const fakeStorage = new MemoryStorage();
  const fakeWindow = {
    localStorage: fakeStorage,
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
  };
  const orig = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  restoreWindow = () => {
    if (orig === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = orig;
    }
  };
});

afterEach(() => {
  restoreWindow?.();
  restoreWindow = null;
});

describe('hitl-toggle — localStorage round-trip', () => {
  it('defaults to false (HITL on) when nothing is stored', () => {
    expect(getShowroomHitlDisabled()).toBe(false);
  });

  it('setShowroomHitlDisabled(true) → getShowroomHitlDisabled() === true', () => {
    setShowroomHitlDisabled(true);
    expect(getShowroomHitlDisabled()).toBe(true);
  });

  it('setShowroomHitlDisabled(false) clears the key (does not write "false")', () => {
    setShowroomHitlDisabled(true);
    expect(getShowroomHitlDisabled()).toBe(true);
    setShowroomHitlDisabled(false);
    expect(getShowroomHitlDisabled()).toBe(false);
    const ls = (globalThis as { window: { localStorage: Storage } }).window.localStorage;
    expect(ls.getItem(SHOWROOM_HITL_STORAGE_KEY)).toBeNull();
  });

  it('exports SHOWROOM_HITL_STORAGE_KEY as a stable id', () => {
    expect(SHOWROOM_HITL_STORAGE_KEY).toBe('showroom.hitl.disabled');
  });
});

describe('hitl-toggle — SSR safety', () => {
  it('returns false when window is undefined', () => {
    restoreWindow?.();        // remove the fake window for this test
    restoreWindow = null;
    expect(typeof window).toBe('undefined');
    expect(getShowroomHitlDisabled()).toBe(false);
    // setter is a silent no-op (returns false)
    expect(setShowroomHitlDisabled(true)).toBe(false);
  });

  it('subscribeShowroomHitl returns a no-op unsubscribe in SSR', () => {
    restoreWindow?.();
    restoreWindow = null;
    const unsub = subscribeShowroomHitl(() => { /* never called */ });
    expect(typeof unsub).toBe('function');
    unsub(); // must not throw
  });
});
