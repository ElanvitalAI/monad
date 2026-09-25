// ── PX-2 P2: PluginStateApi ──
//
// The object handed to plugins as `ctx.state` (wired in P4). Three
// tiers:
//   1. persist / load  — FS-backed (project > user precedence on load)
//   2. session          — in-memory, per-session, subscribable
//   3. listKeys         — enumerate what this plugin has written
//
// Each api instance is plugin-scoped at construction so a plugin can't
// reach another plugin's state through ctx.state (pluginId is closed
// over, not passed in).

import type { PluginStatePersistence, StateScope } from './persistence.js';

export interface PersistOpts<T> {
  scope?: StateScope;   // default 'user'
  /** Optional per-call schema override. When omitted, persistence's
   *  own schema lookup (if any) is used. */
  schema?: { parse: (v: unknown) => T };
}

export interface LoadOpts<T> {
  /** When set, restrict to this scope. When omitted, try project first,
   *  fall back to user (matches DD-PX2-1). */
  scope?: StateScope;
  schema?: { parse: (v: unknown) => T };
}

export interface SessionStateHandle<T> {
  read(): T | null;
  write(value: T): void;
  subscribe(fn: (v: T) => void): () => void;
  clear(): void;
}

export interface PluginStateApi {
  persist<T>(key: string, value: T, opts?: PersistOpts<T>): Promise<void>;
  load<T>(key: string, opts?: LoadOpts<T>): Promise<T | null>;
  session<T>(key: string): SessionStateHandle<T>;
  listKeys(scope?: StateScope): Promise<string[]>;
}

// ── Session map ─────────────────────────────────────────────────────
//
// Shared across one session. plugin-host creates one map and hands it
// to every createPluginStateApi() call so a plugin's api has consistent
// session state across activate/deactivate cycles within the session.

interface SessionEntry<T> {
  value: T | null;
  subs: Set<(v: T) => void>;
}

function ensureEntry(
  map: Map<string, SessionEntry<unknown>>,
  fullKey: string,
): SessionEntry<unknown> {
  let entry = map.get(fullKey);
  if (!entry) {
    entry = { value: null, subs: new Set() };
    map.set(fullKey, entry);
  }
  return entry;
}

export function createSessionStateMap(): Map<string, SessionEntry<unknown>> {
  return new Map();
}

// ── Factory ─────────────────────────────────────────────────────────

export function createPluginStateApi(
  pluginId: string,
  persistence: PluginStatePersistence,
  sessionMap: Map<string, SessionEntry<unknown>> = createSessionStateMap(),
): PluginStateApi {
  const fullSessionKey = (key: string) => `${pluginId}:${key}`;

  return {
    async persist<T>(key: string, value: T, opts: PersistOpts<T> = {}): Promise<void> {
      const scope = opts.scope ?? 'user';
      const validated = opts.schema ? opts.schema.parse(value) : value;
      persistence.write(pluginId, key, validated, scope);
    },

    async load<T>(key: string, opts: LoadOpts<T> = {}): Promise<T | null> {
      if (opts.scope) {
        const raw = persistence.read<T>(pluginId, key, opts.scope);
        return opts.schema && raw !== null ? opts.schema.parse(raw) : raw;
      }
      // No scope → precedence: project > user.
      let raw: T | null = null;
      try { raw = persistence.read<T>(pluginId, key, 'project'); }
      catch { raw = null; }  // projectRoot not configured — fall through
      if (raw !== null) return opts.schema ? opts.schema.parse(raw) : raw;
      const user = persistence.read<T>(pluginId, key, 'user');
      if (user === null) return null;
      return opts.schema ? opts.schema.parse(user) : user;
    },

    session<T>(key: string): SessionStateHandle<T> {
      const fk = fullSessionKey(key);
      // Typed view onto the shared map; entry is created lazily.
      return {
        read(): T | null {
          const e = sessionMap.get(fk);
          return (e?.value ?? null) as T | null;
        },
        write(value: T): void {
          const e = ensureEntry(sessionMap, fk);
          e.value = value;
          for (const sub of e.subs) {
            try { (sub as (v: T) => void)(value); } catch { /* observer isolation */ }
          }
        },
        subscribe(fn: (v: T) => void): () => void {
          const e = ensureEntry(sessionMap, fk);
          const wrapped = fn as (v: unknown) => void;
          e.subs.add(wrapped);
          return () => e.subs.delete(wrapped);
        },
        clear(): void {
          const e = sessionMap.get(fk);
          if (!e) return;
          e.value = null;
          e.subs.clear();
        },
      };
    },

    async listKeys(scope?: StateScope): Promise<string[]> {
      const rows = persistence.list(pluginId, scope);
      return rows.map(r => r.key);
    },
  };
}
