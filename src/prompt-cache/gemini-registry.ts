// In-memory registry mapping (system+tools hash) → Gemini cachedContents name.
//
// Pairs with src/prompt-cache/gemini.ts to give callers a one-liner:
//   const name = await registry.getOrCreate({ system, tools, apiKey, model });
//   if (name) useCache(name);
//
// The registry is intentionally simple:
//   - Hash the input (system + tools JSON) with a stable string → key.
//   - Remember (key → name) with the cache's own expireTime.
//   - On hit: return the existing name.
//   - On miss or past expiry: call createGeminiCache, store the
//     returned name, return it.
//   - Creation failure → return null, caller falls back to no-cache.
//
// Persistence is cross-process (LRU file? config dir?) NOT implemented
// in Phase 1 — the registry resets with the process. This matches
// Gemini's ephemeral TTL model (caches expire in hours anyway).

import { createGeminiCache, type GeminiCacheTTL } from './gemini.js';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// FNV-1a 32-bit — small, fast, collision-acceptable for a process-local
// registry with < 1000 entries. Avoids pulling in a crypto dep for
// what is effectively a memoization key.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface RegistryEntry {
  key: string;
  name: string;                             // cachedContents/<id>
  createdAt: number;                        // ms
  expiresAt: number;                        // ms — derived from ttl
}

export interface GetOrCreateOpts {
  apiKey: string;
  model: string;
  system?: string;
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
  ttl?: GeminiCacheTTL;                     // default '1h'
  displayName?: string;
}

const TTL_MS: Record<GeminiCacheTTL, number> = {
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
};

export class GeminiCacheRegistry {
  private entries = new Map<string, RegistryEntry>();

  /** Compute the stable hash key for a (system, tools) pair. Exported
   *  so callers that want to pre-check the registry (hit?) can do so
   *  without constructing an opts object. */
  hashKey(system: string | undefined, tools: GetOrCreateOpts['tools']): string {
    const payload = stableStringify({ system: system ?? '', tools: tools ?? [] });
    return fnv1a(payload);
  }

  /** Return cached entry (or null) WITHOUT side effects. */
  lookup(system: string | undefined, tools: GetOrCreateOpts['tools']): RegistryEntry | null {
    const key = this.hashKey(system, tools);
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return hit;
  }

  /** Primary API — hit or create. Returns the cache name or null on
   *  failure. Swallows thrown GeminiCacheError so callers can treat
   *  the cache as best-effort. */
  async getOrCreate(opts: GetOrCreateOpts): Promise<string | null> {
    const hit = this.lookup(opts.system, opts.tools);
    if (hit) return hit.name;
    const ttl: GeminiCacheTTL = opts.ttl ?? '1h';
    try {
      const record = await createGeminiCache({
        apiKey: opts.apiKey,
        model: opts.model,
        system: opts.system,
        tools: opts.tools,
        ttl,
        displayName: opts.displayName,
      });
      if (!record?.name) return null;
      const key = this.hashKey(opts.system, opts.tools);
      this.entries.set(key, {
        key,
        name: record.name,
        createdAt: Date.now(),
        expiresAt: Date.now() + TTL_MS[ttl],
      });
      return record.name;
    } catch {
      // Structured errors (GeminiCacheError) and unexpected throws
      // both fall through to null — callers already treat this as
      // "cache unavailable, call without cachedContent".
      return null;
    }
  }

  /** Force-remove an entry by system/tools pair. Useful when the
   *  caller gets a 404 from Gemini (server-side evicted) and wants
   *  the next getOrCreate to recreate. */
  invalidate(system: string | undefined, tools: GetOrCreateOpts['tools']): void {
    const key = this.hashKey(system, tools);
    this.entries.delete(key);
  }

  /** Wipe all entries. Useful for tests; real callers rarely need. */
  clear(): void {
    this.entries.clear();
  }

  /** Inspect the registry for debug / `/cache` verbose output. */
  list(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }
}

/** Shared process-scoped registry. Dashboard / skills should use
 *  this instance to deduplicate across calls without plumbing an
 *  instance through every caller. Tests that want isolation should
 *  new-up their own `GeminiCacheRegistry`. */
export const geminiCacheRegistry = new GeminiCacheRegistry();
