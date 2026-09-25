import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { loadDaemonConfig, saveDaemonConfig } from './daemon-config';

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

interface FakeWindow {
  location: { protocol: string; host: string };
}

describe('daemon-config — NEXUS PR a (v6) baseUrl cutover', () => {
  let prevWindow: unknown;
  let prevStorage: Storage | undefined;

  beforeEach(() => {
    prevWindow = globalThis.window;
    prevStorage = globalThis.localStorage;
    const fake: FakeWindow = {
      location: { protocol: 'https:', host: 'mbp.tailnet.ts.net:31415' },
    };
    globalThis.window = fake;
    globalThis.localStorage = new MemoryStorage();
  });

  afterEach(() => {
    globalThis.window = prevWindow as never;
    if (prevStorage) globalThis.localStorage = prevStorage;
    else delete globalThis.localStorage;
  });

  test('loads nexus baseUrl when present', () => {
    localStorage.setItem('monad.nexus.baseUrl', 'https://nexus.example:31415');
    localStorage.setItem('monad.daemon.token', 't0');
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://nexus.example:31415');
    expect(cfg.token).toBe('t0');
  });

  test('migrates legacy monad.daemon.baseUrl → monad.nexus.baseUrl on first load', () => {
    localStorage.setItem('monad.daemon.baseUrl', 'https://daemon.example:31415');
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://daemon.example:31415');
    expect(localStorage.getItem('monad.nexus.baseUrl')).toBe('https://daemon.example:31415');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBeNull();
  });

  test('nexus key wins over legacy daemon key (no overwrite)', () => {
    localStorage.setItem('monad.nexus.baseUrl', 'https://current.example');
    localStorage.setItem('monad.daemon.baseUrl', 'https://stale.example');
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://current.example');
    // The stale legacy key is left alone so any *other* downstream that
    // hasn't migrated yet still sees the previous value (we only touch
    // the legacy key when it's the migration source).
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBe('https://stale.example');
  });

  test('migrates legacy monad.voice.wsUrl → monad.nexus.baseUrl via URL transform', () => {
    localStorage.setItem('monad.voice.wsUrl', 'wss://mbp.tailnet.ts.net:31415/v1/voice/ws');
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://mbp.tailnet.ts.net:31415');
    expect(localStorage.getItem('monad.voice.wsUrl')).toBeNull();
  });

  test('legacy daemon baseUrl precedes legacy voice wsUrl when both present', () => {
    localStorage.setItem('monad.daemon.baseUrl', 'https://daemon.example:31415');
    localStorage.setItem('monad.voice.wsUrl', 'wss://voice.example:31415/v1/voice/ws');
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://daemon.example:31415');
    // Voice key is left in place since the daemon migration ran first
    // and consumed the slot — second migrate sees currentKey populated
    // and skips, so legacy voice key is untouched.
    expect(localStorage.getItem('monad.voice.wsUrl')).toBe('wss://voice.example:31415/v1/voice/ws');
    expect(localStorage.getItem('monad.daemon.baseUrl')).toBeNull();
  });

  test('migrates legacy voice token → daemon token slot', () => {
    localStorage.setItem('monad.voice.token', 'voice-tok');
    const cfg = loadDaemonConfig();
    expect(cfg.token).toBe('voice-tok');
  });

  test('falls back to window.location origin when no stored baseUrl', () => {
    const cfg = loadDaemonConfig();
    expect(cfg.baseUrl).toBe('https://mbp.tailnet.ts.net:31415');
  });

  test('saveDaemonConfig writes to nexus key', () => {
    saveDaemonConfig({ baseUrl: 'https://new.example', token: 't1' });
    expect(localStorage.getItem('monad.nexus.baseUrl')).toBe('https://new.example');
    expect(localStorage.getItem('monad.daemon.token')).toBe('t1');
  });

  test('SSR (no window) yields empty config', () => {
    delete (globalThis as { window?: unknown }).window;
    const cfg = loadDaemonConfig();
    expect(cfg).toEqual({ baseUrl: '', token: '', provider: '' });
  });
});
