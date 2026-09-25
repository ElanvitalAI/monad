// ElementRegistry — global address book across every element kind.
//
// Each kind maintains its own Map<id, handle>. Resolution accepts:
//   • raw id (scanned across kinds, first match wins)
//   • qualified address (`<prefix>:<id>`)
// Cross-kind id collisions are vanishingly rare in a single session
// (win is int, pane is 6-hex, PTY is `pty_` + 8-hex, etc.), but tools
// that receive un-qualified ids should pass the expected kind to
// `resolve` to avoid ambiguity.
//
// Not a heavy abstraction: delegates lookups; owners (PTY registry,
// VirtualWindows, scheduler) are still the source of truth for
// lifecycles. Registry is a directory, not a store.

import { formatElementAddress, parseElementAddress } from './address.js';
import type { ElementHandle, ElementKind } from './types.js';

export interface ElementRegistry {
  register(kind: ElementKind, id: string, handle: ElementHandle): void;
  unregister(kind: ElementKind, id: string): void;
  has(kind: ElementKind, id: string): boolean;
  resolve<T extends ElementHandle = ElementHandle>(
    idOrAddr: string,
    expectedKind?: ElementKind,
  ): T | null;
  list(kind: ElementKind): Array<{ id: string; addr: string; handle: ElementHandle }>;
  listAll(): Array<{ kind: ElementKind; id: string; addr: string; handle: ElementHandle }>;
  count(kind: ElementKind): number;
  reset(): void;
}

export function createElementRegistry(): ElementRegistry {
  const byKind = new Map<ElementKind, Map<string, ElementHandle>>();

  const mapOf = (kind: ElementKind): Map<string, ElementHandle> => {
    let m = byKind.get(kind);
    if (!m) { m = new Map(); byKind.set(kind, m); }
    return m;
  };

  return {
    register(kind, id, handle) {
      mapOf(kind).set(id, handle);
    },
    unregister(kind, id) {
      byKind.get(kind)?.delete(id);
    },
    has(kind, id) {
      return byKind.get(kind)?.has(id) ?? false;
    },
    resolve<T extends ElementHandle = ElementHandle>(
      idOrAddr: string,
      expectedKind?: ElementKind,
    ): T | null {
      const parsed = parseElementAddress(idOrAddr);
      if (parsed) {
        if (expectedKind && parsed.kind !== expectedKind) return null;
        return (byKind.get(parsed.kind)?.get(parsed.id) ?? null) as T | null;
      }
      if (expectedKind) {
        return (byKind.get(expectedKind)?.get(idOrAddr) ?? null) as T | null;
      }
      for (const m of byKind.values()) {
        const h = m.get(idOrAddr);
        if (h) return h as T;
      }
      return null;
    },
    list(kind) {
      const m = byKind.get(kind);
      if (!m) return [];
      return [...m.entries()].map(([id, handle]) => ({
        id,
        addr: formatElementAddress(kind, id),
        handle,
      }));
    },
    listAll() {
      const out: Array<{ kind: ElementKind; id: string; addr: string; handle: ElementHandle }> = [];
      for (const [kind, m] of byKind) {
        for (const [id, handle] of m) {
          out.push({ kind, id, addr: formatElementAddress(kind, id), handle });
        }
      }
      return out;
    },
    count(kind) {
      return byKind.get(kind)?.size ?? 0;
    },
    reset() {
      byKind.clear();
    },
  };
}

// Singleton — modules register on startup, LLM tools resolve via it.
let _global: ElementRegistry | null = null;
export function getGlobalElementRegistry(): ElementRegistry {
  if (!_global) _global = createElementRegistry();
  return _global;
}
export function _resetGlobalElementRegistryForTesting(): void {
  _global = null;
}
