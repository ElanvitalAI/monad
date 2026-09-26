/**
 * WT-M-1 peer-id contract test. sessionStorage persistence + crypto
 * fallback + module-level cache 검증.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

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

const STORAGE_KEY = 'elanous.pwa.peerId';
const realWindow = (globalThis as { window?: unknown }).window;

function installWindow(storage: Storage): void {
  (globalThis as { window: unknown }).window = { sessionStorage: storage };
}

function uninstallWindow(): void {
  if (realWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = realWindow;
  }
}

describe('getPeerId', () => {
  beforeEach(() => {
    // Bun caches modules — clear the module so each test gets a fresh
    // cached value inside peer-id.ts. `delete require.cache[…]` doesn't
    // exist in ESM but `mock.module` would reach for hot reload; here
    // we use the import.meta jiggling via dynamic import + key bust.
  });
  afterEach(() => uninstallWindow());

  it('returns a non-empty string when sessionStorage is empty (mints + persists)', async () => {
    installWindow(new MemoryStorage());
    const mod = await import(`./peer-id?fresh=${Math.random()}`);
    const id = mod.getPeerId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('persists the minted id back to sessionStorage', async () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    const mod = await import(`./peer-id?fresh=${Math.random()}`);
    const id = mod.getPeerId();
    expect(storage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('caches the id in-module — repeated calls return the same value', async () => {
    installWindow(new MemoryStorage());
    const mod = await import(`./peer-id?fresh=${Math.random()}`);
    const a = mod.getPeerId();
    const b = mod.getPeerId();
    const c = mod.getPeerId();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('rehydrates the stored id when sessionStorage already has one', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, 'preexisting');
    installWindow(storage);
    const mod = await import(`./peer-id?fresh=${Math.random()}`);
    expect(mod.getPeerId()).toBe('preexisting');
  });

  it('still returns an id when window is undefined (SSR safe)', async () => {
    uninstallWindow();
    const mod = await import(`./peer-id?fresh=${Math.random()}`);
    const id = mod.getPeerId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
