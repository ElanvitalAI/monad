export type VirtualCursorKind =
  | 'caret'
  | 'selection-anchor'
  | 'message-cursor'
  | 'range-selection';

export type VirtualCursorScope =
  | 'input'
  | 'modal'
  | 'workspace'
  | 'terminal'
  | 'pane';

export interface VirtualCursorDescriptor {
  readonly id: string;
  readonly kind: VirtualCursorKind;
  readonly row: number;
  readonly col: number;
  readonly endRow?: number;
  readonly endCol?: number;
  readonly owner?: string;
  readonly scope?: VirtualCursorScope;
  readonly active?: boolean;
  readonly visible?: boolean;
  readonly zIndex?: number;
}

export interface VirtualCursorRegistryChangeEvent {
  readonly type: 'upsert' | 'remove' | 'clear' | 'clear-owner';
  readonly descriptor?: VirtualCursorDescriptor;
  readonly id?: string;
  readonly owner?: string;
}

export interface VirtualCursorRegistry {
  upsert(descriptor: VirtualCursorDescriptor): void;
  get(id: string): VirtualCursorDescriptor | undefined;
  remove(id: string): void;
  list(): readonly VirtualCursorDescriptor[];
  listVisible(): readonly VirtualCursorDescriptor[];
  listByOwner(owner: string): readonly VirtualCursorDescriptor[];
  clearOwner(owner: string): void;
  clear(): void;
  onChange(cb: (event: VirtualCursorRegistryChangeEvent) => void): () => void;
}

class VirtualCursorRegistryImpl implements VirtualCursorRegistry {
  private readonly entries = new Map<string, VirtualCursorDescriptor>();
  private readonly subs = new Set<(event: VirtualCursorRegistryChangeEvent) => void>();

  upsert(descriptor: VirtualCursorDescriptor): void {
    this.entries.set(descriptor.id, descriptor);
    this.emit({ type: 'upsert', descriptor });
  }

  get(id: string): VirtualCursorDescriptor | undefined {
    return this.entries.get(id);
  }

  remove(id: string): void {
    if (!this.entries.has(id)) return;
    this.entries.delete(id);
    this.emit({ type: 'remove', id });
  }

  list(): readonly VirtualCursorDescriptor[] {
    return [...this.entries.values()];
  }

  listVisible(): readonly VirtualCursorDescriptor[] {
    return this.list().filter((entry) => entry.visible !== false);
  }

  listByOwner(owner: string): readonly VirtualCursorDescriptor[] {
    return this.list().filter((entry) => entry.owner === owner);
  }

  clearOwner(owner: string): void {
    let changed = false;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.owner !== owner) continue;
      this.entries.delete(id);
      changed = true;
    }
    if (changed) this.emit({ type: 'clear-owner', owner });
  }

  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.emit({ type: 'clear' });
  }

  onChange(cb: (event: VirtualCursorRegistryChangeEvent) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  private emit(event: VirtualCursorRegistryChangeEvent): void {
    for (const sub of [...this.subs]) {
      try {
        sub(event);
      } catch {
        // Virtual cursor observers must not destabilize the coord path.
      }
    }
  }
}

export function createVirtualCursorRegistry(): VirtualCursorRegistry {
  return new VirtualCursorRegistryImpl();
}
