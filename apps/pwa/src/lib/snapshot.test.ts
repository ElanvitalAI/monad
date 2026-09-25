import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  __INTERNAL_MAX_BYTES,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  snapshotKey,
} from './snapshot';

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

const originalWindow = (globalThis as { window?: unknown }).window;

function installWindow(storage?: Storage | null): void {
  (globalThis as { window: unknown }).window = storage === null
    ? { localStorage: undefined }
    : { localStorage: storage ?? new MemoryStorage() };
}

function uninstallWindow(): void {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = originalWindow;
  }
}

describe('snapshot helper', () => {
  beforeEach(() => installWindow());
  afterEach(() => uninstallWindow());

  it('round-trips chatInput payload via key helper', () => {
    const key = snapshotKey('chatInput', 'tab-7');
    saveSnapshot(key, { text: 'half-typed prompt', revision: 3 });
    expect(loadSnapshot<{ text: string; revision: number }>(key)).toEqual({
      text: 'half-typed prompt',
      revision: 3,
    });
  });

  it('returns null for missing key', () => {
    expect(loadSnapshot('monad.pwa.snapshot.chatInput.missing')).toBeNull();
  });

  it('clear removes the entry', () => {
    const key = snapshotKey('chatScroll', 'tab-1');
    saveSnapshot(key, 420);
    expect(loadSnapshot<number>(key)).toBe(420);
    clearSnapshot(key);
    expect(loadSnapshot(key)).toBeNull();
  });

  it('drops oversized payload silently (no throw)', () => {
    const key = snapshotKey('xtermScrollback', 'term-1');
    const huge = 'x'.repeat(__INTERNAL_MAX_BYTES + 32);
    saveSnapshot(key, huge);
    expect(loadSnapshot(key)).toBeNull();
  });

  it('treats malformed JSON as missing and clears it', () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    const key = snapshotKey('chatInput', 'corrupt');
    storage.setItem(key, '{not json');
    expect(loadSnapshot(key)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('is SSR-safe — returns null + no throw without window', () => {
    uninstallWindow();
    const key = snapshotKey('chatInput', 'tab-1');
    expect(() => saveSnapshot(key, 'noop')).not.toThrow();
    expect(loadSnapshot(key)).toBeNull();
    expect(() => clearSnapshot(key)).not.toThrow();
  });

  it('snapshotKey falls back to singleton for empty id', () => {
    expect(snapshotKey('chatInput', undefined)).toBe('monad.pwa.snapshot.chatInput.singleton');
    expect(snapshotKey('chatInput', '')).toBe('monad.pwa.snapshot.chatInput.singleton');
    expect(snapshotKey('chatInput', 'tab-9')).toBe('monad.pwa.snapshot.chatInput.tab-9');
  });
});
