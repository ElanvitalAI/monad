export interface CompanionSurfaceHandle {
  dispose(): void;
}

export interface CompanionSurfaceHost<K extends string> {
  readonly ownerId: string;
  readonly allKeys: readonly K[];
  includes(key: string): key is K;
  listOpen(): K[];
  isOpen(key: K): boolean;
  isDocked(key: K): boolean;
  isActive(key: K): boolean;
  markOpen(key: K): void;
  markDocked(key: K): void;
  close(key: K): void;
  setOpen(key: K, next: boolean): void;
  toggleOpen(key: K): boolean;
  setHandle(key: K, handle: CompanionSurfaceHandle): void;
  getHandle(key: K): CompanionSurfaceHandle | undefined;
  disposeHandles(): void;
}

export function createCompanionSurfaceHost<K extends string>(
  ownerId: string,
  allKeys: readonly K[],
): CompanionSurfaceHost<K> {
  const open = new Set<K>();
  const docked = new Set<K>();
  const handles = new Map<K, CompanionSurfaceHandle>();
  const keySet = new Set<K>(allKeys);

  return {
    ownerId,
    allKeys,
    includes(key: string): key is K {
      return keySet.has(key as K);
    },
    listOpen(): K[] {
      return [...open.values()];
    },
    isOpen(key: K): boolean {
      return open.has(key);
    },
    isDocked(key: K): boolean {
      return docked.has(key);
    },
    isActive(key: K): boolean {
      return open.has(key) || docked.has(key);
    },
    markOpen(key: K): void {
      docked.delete(key);
      open.add(key);
    },
    markDocked(key: K): void {
      open.delete(key);
      docked.add(key);
    },
    close(key: K): void {
      open.delete(key);
      docked.delete(key);
    },
    setOpen(key: K, next: boolean): void {
      if (next) {
        docked.delete(key);
        open.add(key);
        return;
      }
      open.delete(key);
      docked.delete(key);
    },
    toggleOpen(key: K): boolean {
      const next = !open.has(key);
      if (next) {
        docked.delete(key);
        open.add(key);
      } else {
        open.delete(key);
        docked.delete(key);
      }
      return next;
    },
    setHandle(key: K, handle: CompanionSurfaceHandle): void {
      handles.set(key, handle);
    },
    getHandle(key: K): CompanionSurfaceHandle | undefined {
      return handles.get(key);
    },
    disposeHandles(): void {
      for (const handle of handles.values()) handle.dispose();
      handles.clear();
    },
  };
}
