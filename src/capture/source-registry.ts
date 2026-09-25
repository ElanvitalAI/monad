// H6 P6 · Capture source registry.
//
// Thin lookup + dispatch layer over the existing capture infrastructure.
// Providers register by `type` (one provider per type); `list()` fans
// out to every provider and returns a flat descriptor array; `snapshot()`
// parses the `<type>:<native>` id, routes to the provider, and returns
// the provider's SnapshotResult verbatim.
//
// Design rails (PLAN §D1, §D10, §D11):
//   - D1  Static type registration · one provider per type · no
//         per-instance registration churn.
//   - D10 `list()` isolates provider failures · a Chrome-unavailable
//         CDP provider should not block VW pane enumeration.
//   - D11 Singleton `defaultCaptureSourceRegistry()` for prod use;
//         tests construct a fresh `new CaptureSourceRegistry()` to
//         avoid shared state.

import { debug } from '../debug/log.js';
import {
  UnknownCaptureSourceError,
  type CaptureSourceDescriptor,
  type CaptureSourceProvider,
  type SnapshotOpts,
  type SnapshotResult,
} from './providers/types.js';

export class CaptureSourceRegistry {
  private providers = new Map<string, CaptureSourceProvider>();

  /** Register a provider. Returns a disposer that unregisters.
   *  Throws on duplicate type so silent shadowing is impossible. */
  registerProvider(provider: CaptureSourceProvider): () => void {
    if (this.providers.has(provider.type)) {
      throw new Error(
        `CaptureSourceRegistry: provider type '${provider.type}' already registered`,
      );
    }
    this.providers.set(provider.type, provider);
    if (debug.enabled) {
      debug.log('capture.registry.register', provider.type, {});
    }
    return () => this.providers.delete(provider.type);
  }

  /** Descriptor list across every provider · ordered by registration
   *  insertion. A failing provider is skipped (D10 isolation) and
   *  logged; its error does not bubble to the caller. */
  list(): readonly CaptureSourceDescriptor[] {
    const out: CaptureSourceDescriptor[] = [];
    for (const provider of this.providers.values()) {
      try {
        out.push(...provider.list());
      } catch (err) {
        if (debug.enabled) {
          debug.log('capture.registry.list-provider-failed', provider.type, {
            error: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
    }
    return out;
  }

  /** Lookup a descriptor by exact id · linear across providers so
   *  ids discovered via `list()` are always findable. */
  get(id: string): CaptureSourceDescriptor | undefined {
    for (const provider of this.providers.values()) {
      let list: readonly CaptureSourceDescriptor[] = [];
      try { list = provider.list(); } catch { list = []; }
      const hit = list.find((d) => d.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Snapshot route. Parses the `<type>:<native>` prefix, routes to
   *  the matching provider, and forwards to its `snapshot()`. A
   *  malformed id (no colon, or type has no provider) surfaces as
   *  `UnknownCaptureSourceError`. */
  async snapshot(id: string, opts: SnapshotOpts = {}): Promise<SnapshotResult> {
    const type = parseSourceType(id);
    const provider = this.providers.get(type);
    if (!provider) {
      throw new UnknownCaptureSourceError(id, type);
    }
    return provider.snapshot(id, opts);
  }

  /** Count per registered provider type · for LLM tool metadata. */
  countByType(): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const provider of this.providers.values()) {
      let len = 0;
      try { len = provider.list().length; } catch { len = 0; }
      counts[provider.type] = len;
    }
    return counts;
  }

  registeredTypes(): readonly string[] {
    return [...this.providers.keys()];
  }

  /** Test isolation helper · drops every provider + internal state. */
  clear(): void {
    this.providers.clear();
  }
}

/** Parse the `<type>` prefix of a canonical source id. Throws when
 *  the id shape is invalid. Caller layer uses the resulting string
 *  to look up a provider — treat the return as opaque (built-in
 *  providers match `CaptureSourceType`). */
export function parseSourceType(id: string): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`CaptureSourceRegistry: invalid source id (empty)`);
  }
  const idx = id.indexOf(':');
  if (idx < 1) {
    throw new Error(
      `CaptureSourceRegistry: invalid source id '${id}' · expected <type>:<native-id>`,
    );
  }
  return id.slice(0, idx);
}

/** Build a canonical source id from a type + native part. Used by
 *  providers so the format is enforced in one place. */
export function buildSourceId(type: string, native: string): string {
  if (native.includes(':')) {
    throw new Error(
      `CaptureSourceRegistry: native id '${native}' must not contain ':' (type=${type})`,
    );
  }
  return `${type}:${native}`;
}

// ─── Singleton ─────────────────────────────────────────────────────

let _default: CaptureSourceRegistry | null = null;

export function defaultCaptureSourceRegistry(): CaptureSourceRegistry {
  if (!_default) _default = new CaptureSourceRegistry();
  return _default;
}

export function _resetDefaultCaptureSourceRegistryForTesting(): void {
  if (_default) _default.clear();
  _default = null;
}
