import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { migrateBaseUrl } from './migrate-base-url';

declare const globalThis: {
  window?: unknown;
  localStorage?: Storage;
};

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('migrateBaseUrl', () => {
  let prevWindow: unknown;
  let prevStorage: Storage | undefined;

  beforeEach(() => {
    prevWindow = globalThis.window;
    prevStorage = globalThis.localStorage;
    globalThis.window = {};
    globalThis.localStorage = new MemoryStorage();
  });

  afterEach(() => {
    globalThis.window = prevWindow as never;
    if (prevStorage) globalThis.localStorage = prevStorage;
    else delete globalThis.localStorage;
  });

  test('migrates legacy → current when current absent', () => {
    localStorage.setItem('monad.daemon.baseUrl', 'https://mbp.tailnet.ts.net:31415');
    const res = migrateBaseUrl({
      legacyKey: 'monad.daemon.baseUrl',
      currentKey: 'monad.nexus.baseUrl',
    });
    expect(res.migrated).toBe(true);
    expect(res.currentValue).toBe('https://mbp.tailnet.ts.net:31415');
    expect(localStorage.getItem('monad.nexus.baseUrl')).toBe('https://mbp.tailnet.ts.net:31415');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBeNull();
  });

  test('skips when current already set', () => {
    localStorage.setItem('monad.daemon.baseUrl', 'https://old.example');
    localStorage.setItem('monad.nexus.baseUrl', 'https://new.example');
    const res = migrateBaseUrl({
      legacyKey: 'monad.daemon.baseUrl',
      currentKey: 'monad.nexus.baseUrl',
    });
    expect(res.migrated).toBe(false);
    expect(res.currentValue).toBe('https://new.example');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBe('https://old.example');
  });

  test('no-op when neither legacy nor current present', () => {
    const res = migrateBaseUrl({
      legacyKey: 'monad.daemon.baseUrl',
      currentKey: 'monad.nexus.baseUrl',
    });
    expect(res.migrated).toBe(false);
    expect(res.currentValue).toBeNull();
  });

  test('transformValue can rewrite legacy form', () => {
    localStorage.setItem('monad.voice.wsUrl', 'wss://mbp.tailnet.ts.net:31415/v1/voice/ws');
    const res = migrateBaseUrl({
      legacyKey: 'monad.voice.wsUrl',
      currentKey: 'monad.daemon.baseUrl',
      transformValue: (raw) => {
        try {
          const u = new URL(raw);
          u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
          u.pathname = '/';
          return u.toString().replace(/\/$/, '');
        } catch {
          return null;
        }
      },
    });
    expect(res.migrated).toBe(true);
    expect(res.currentValue).toBe('https://mbp.tailnet.ts.net:31415');
  });

  test('transformValue returning null aborts migration silently', () => {
    localStorage.setItem('monad.voice.wsUrl', 'not-a-url');
    const res = migrateBaseUrl({
      legacyKey: 'monad.voice.wsUrl',
      currentKey: 'monad.daemon.baseUrl',
      transformValue: () => null,
    });
    expect(res.migrated).toBe(false);
    expect(localStorage.getItem('monad.voice.wsUrl')).toBe('not-a-url');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBeNull();
  });

  test('transform throwing is treated as null (legacy kept)', () => {
    localStorage.setItem('monad.voice.wsUrl', 'whatever');
    const res = migrateBaseUrl({
      legacyKey: 'monad.voice.wsUrl',
      currentKey: 'monad.daemon.baseUrl',
      transformValue: () => {
        throw new Error('boom');
      },
    });
    expect(res.migrated).toBe(false);
    expect(localStorage.getItem('monad.voice.wsUrl')).toBe('whatever');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBeNull();
  });

  test('SSR (no window) is a no-op', () => {
    delete (globalThis as { window?: unknown }).window;
    const res = migrateBaseUrl({
      legacyKey: 'monad.daemon.baseUrl',
      currentKey: 'monad.nexus.baseUrl',
    });
    expect(res.migrated).toBe(false);
    expect(res.currentValue).toBeNull();
  });
});
