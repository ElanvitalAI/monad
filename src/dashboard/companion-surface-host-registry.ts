import {
  createCompanionSurfaceHost,
  type CompanionSurfaceHost,
} from './companion-surface-host.js';

export interface CompanionSurfaceHostRegistry<K extends string> {
  ensure(ownerId: string, allKeys: readonly K[]): CompanionSurfaceHost<K>;
  get(ownerId: string): CompanionSurfaceHost<K> | null;
  listOwnerIds(): string[];
}

export function createCompanionSurfaceHostRegistry<K extends string>(): CompanionSurfaceHostRegistry<K> {
  const hosts = new Map<string, CompanionSurfaceHost<K>>();
  return {
    ensure(ownerId: string, allKeys: readonly K[]): CompanionSurfaceHost<K> {
      const existing = hosts.get(ownerId);
      if (existing) return existing;
      const created = createCompanionSurfaceHost(ownerId, allKeys);
      hosts.set(ownerId, created);
      return created;
    },
    get(ownerId: string): CompanionSurfaceHost<K> | null {
      return hosts.get(ownerId) ?? null;
    },
    listOwnerIds(): string[] {
      return [...hosts.keys()];
    },
  };
}
