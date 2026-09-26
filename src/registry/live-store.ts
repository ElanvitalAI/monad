// RFC #2161 Phase 5 — Live Registry store.
//
// Layer B from the RFC (apiKey availability + health + rate-limit) on
// top of Layer A (static catalog). Phase 5 ships the apiKey-presence
// + manual override surface; the health probe + rate-limit
// observability lands in Phase 6 (Discovery) which already needs the
// per-provider HTTP infrastructure.
//
// State is kept in-process. A JSON snapshot persists to
// `~/.elanous/registry.json` (flat path, per the Phase 5 entry decision)
// so a daemon restart preserves the manual overrides — env-driven
// fields are recomputed on boot, not read from disk.
//
// Subscribers (the SSE broadcast at GET /v1/registry/events) attach
// via `subscribe(listener)`. The store fires events on every mutation
// and the listener decides whether to re-broadcast (debouncing /
// throttling lives at the broadcaster).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCatalog } from './loader.js';
import type { Catalog } from './types.js';
import { getElanousConfigDir, getElanousConfigDirOverride } from '../elanous-config-dir.js';

export type ProviderAvailability =
  | 'available'      // apiKey present (env or override) AND no manual disable
  | 'no-api-key'     // apiKey env unset and no override key
  | 'disabled'       // user manually disabled this provider
  | 'unknown';       // catalog provider missing apiKeyEnv (e.g. local hosts)

export interface ProviderLiveState {
  /** Canonical provider id (matches `ProviderRegistration.id`). */
  id: string;
  /** Computed availability. Updated on env change + manual mutation. */
  availability: ProviderAvailability;
  /** Whether the apiKey env var is non-empty. */
  apiKeyEnvSet: boolean;
  /** Manual override — null when no override (env decides). When set,
   *  takes priority over the env: `disabled = true` forces 'disabled'
   *  even when the key is present. */
  manualDisabled: boolean;
  /** Most recent observation time (ms since epoch). */
  observedAt: number;
}

export interface LiveStoreSnapshot {
  /** Per-provider live state, sorted by provider id. */
  providers: ProviderLiveState[];
  /** Schema version — bumped when the snapshot shape changes. */
  version: number;
  /** When the snapshot was last serialised. */
  savedAt: number;
}

export type LiveStoreEvent =
  | { type: 'provider-changed'; providerId: string; state: ProviderLiveState }
  | { type: 'reload' };

type Listener = (event: LiveStoreEvent) => void;

const SNAPSHOT_VERSION = 1;

function defaultSnapshotPath(): string {
  // An explicit `--config-dir` / `setElanousConfigDir()` is authoritative.
  // Otherwise ELANOUS_TEST_HOME isolates direct test execution even when the
  // instance-root resolver memoized the production default before the test.
  const explicitConfigDir = getElanousConfigDirOverride();
  if (explicitConfigDir) return join(explicitConfigDir, 'registry.json');
  const testHome = process.env.ELANOUS_TEST_HOME?.trim();
  if (testHome) return join(testHome, '.elanous', 'registry.json');
  return join(getElanousConfigDir(), 'registry.json');
}

function ensureDir(path: string): void {
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* best effort */ }
}

class LiveStore {
  private byProvider = new Map<string, ProviderLiveState>();
  private listeners = new Set<Listener>();
  private snapshotPath: string;
  private cat: Catalog | null = null;

  constructor(snapshotPath: string = defaultSnapshotPath()) {
    this.snapshotPath = snapshotPath;
  }

  /** Lazy-init: read the catalog + replay any persisted manual
   *  overrides on first access. Tests reset via `reload()`. */
  private ensureLoaded(): void {
    if (this.cat) return;
    this.cat = getCatalog();
    const overrides = this.readPersistedOverrides();
    for (const provider of this.cat.providers.values()) {
      const apiKeyEnv = provider.apiKeyEnv?.trim() ?? '';
      const apiKeyEnvSet = apiKeyEnv.length > 0
        && (process.env[apiKeyEnv] ?? '').trim().length > 0;
      const manualDisabled = overrides.get(provider.id) ?? false;
      this.byProvider.set(provider.id, {
        id: provider.id,
        availability: computeAvailability({ apiKeyEnv, apiKeyEnvSet, manualDisabled }),
        apiKeyEnvSet,
        manualDisabled,
        observedAt: Date.now(),
      });
    }
  }

  /** Get the live state snapshot — ordered by provider id. */
  list(): ProviderLiveState[] {
    this.ensureLoaded();
    return [...this.byProvider.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Read a single provider's live state. Returns null when the
   *  provider isn't in the catalog. */
  get(providerId: string): ProviderLiveState | null {
    this.ensureLoaded();
    return this.byProvider.get(providerId) ?? null;
  }

  /** Manually mark a provider disabled / enabled. Persists the new
   *  override + emits `provider-changed`. */
  setManualDisabled(providerId: string, disabled: boolean): ProviderLiveState | null {
    this.ensureLoaded();
    const cur = this.byProvider.get(providerId);
    if (!cur) return null;
    if (cur.manualDisabled === disabled) return cur;
    const provider = this.cat?.providers.get(providerId);
    const apiKeyEnv = provider?.apiKeyEnv?.trim() ?? '';
    const apiKeyEnvSet = apiKeyEnv.length > 0
      && (process.env[apiKeyEnv] ?? '').trim().length > 0;
    const next: ProviderLiveState = {
      id: providerId,
      apiKeyEnvSet,
      manualDisabled: disabled,
      availability: computeAvailability({ apiKeyEnv, apiKeyEnvSet, manualDisabled: disabled }),
      observedAt: Date.now(),
    };
    this.byProvider.set(providerId, next);
    this.persistOverrides();
    this.emit({ type: 'provider-changed', providerId, state: next });
    return next;
  }

  /** Recompute env-derived availability — call after env mutation
   *  (e.g. apiKey rotation) so subscribers see the change immediately. */
  refreshFromEnv(): void {
    this.ensureLoaded();
    if (!this.cat) return;
    for (const provider of this.cat.providers.values()) {
      const cur = this.byProvider.get(provider.id);
      if (!cur) continue;
      const apiKeyEnv = provider.apiKeyEnv?.trim() ?? '';
      const apiKeyEnvSet = apiKeyEnv.length > 0
        && (process.env[apiKeyEnv] ?? '').trim().length > 0;
      if (cur.apiKeyEnvSet === apiKeyEnvSet) continue;
      const next: ProviderLiveState = {
        id: provider.id,
        apiKeyEnvSet,
        manualDisabled: cur.manualDisabled,
        availability: computeAvailability({
          apiKeyEnv,
          apiKeyEnvSet,
          manualDisabled: cur.manualDisabled,
        }),
        observedAt: Date.now(),
      };
      this.byProvider.set(provider.id, next);
      this.emit({ type: 'provider-changed', providerId: provider.id, state: next });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Drop in-memory state + reload catalog. Tests use this between
   *  cases; production callers use `refreshFromEnv()` for env-only. */
  reload(): void {
    this.byProvider.clear();
    this.cat = null;
    this.ensureLoaded();
    this.emit({ type: 'reload' });
  }

  /** Test seam — overrides path the next snapshot persists to. */
  __setSnapshotPathForTests(path: string): void {
    this.snapshotPath = path;
  }

  // ── persistence ────────────────────────────────────────────────────

  private readPersistedOverrides(): Map<string, boolean> {
    const out = new Map<string, boolean>();
    if (!existsSync(this.snapshotPath)) return out;
    try {
      const raw = readFileSync(this.snapshotPath, 'utf-8');
      const json = JSON.parse(raw) as Partial<LiveStoreSnapshot>;
      if (!json || typeof json !== 'object' || !Array.isArray(json.providers)) return out;
      for (const entry of json.providers) {
        if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
          out.set(entry.id, entry.manualDisabled === true);
        }
      }
    } catch { /* corrupted snapshot — ignore */ }
    return out;
  }

  private persistOverrides(): void {
    ensureDir(this.snapshotPath);
    const snapshot: LiveStoreSnapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      providers: this.list(),
    };
    try {
      writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch { /* best-effort */ }
  }

  private emit(event: LiveStoreEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* listener throws shouldn't break others */ }
    }
  }
}

function computeAvailability(opts: {
  apiKeyEnv: string;
  apiKeyEnvSet: boolean;
  manualDisabled: boolean;
}): ProviderAvailability {
  if (opts.manualDisabled) return 'disabled';
  if (!opts.apiKeyEnv) return 'unknown';
  if (opts.apiKeyEnvSet) return 'available';
  return 'no-api-key';
}

let _instance: LiveStore | null = null;

/** Per-process singleton accessor. */
export function getLiveStore(): LiveStore {
  if (_instance) return _instance;
  _instance = new LiveStore();
  return _instance;
}

/** Test-only — discard the singleton so the next `getLiveStore()` boots
 *  fresh against the current catalog + env. */
export function __resetLiveStoreForTests(): void {
  _instance = null;
}

export type { LiveStore };
