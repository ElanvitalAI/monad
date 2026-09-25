// H6 P1 Bundle 1 · Central UsageStore.
//
// One observable store per monad process · holds current snapshots +
// errors + lastFetchAt for every registered provider. LLM tools read
// from here; `/budget` slash reads from here; future widgets subscribe
// to change events.
//
// Fetcher lifecycle (PLAN §4.2):
//   1. Caller constructs a ProviderFetcher for codex/claude/gemini/...
//   2. `registerFetcher(provider, fetcher)` attaches it to the store.
//   3. `refresh(provider?)` runs the fetcher · wraps failures through
//      the per-provider `ConsecutiveFailureGate` · commits snapshot on
//      success · leaves last snapshot intact on single-flake failure.
//
// Turn lifecycle:
//   - Recorder (log scan · Bundle 1) calls `recordTurn(summary)`.
//   - UsageStore forwards to the BudgetHistoryStore (SQLite) so the
//     forecaster (Bundle 2) + `/budget history` can read aggregates.
//
// Persistence (PLAN D1):
//   - Current snapshot → JSON atomic write (`state.json`) so a fresh
//     process boot has a warm cache before the first fetch completes.
//   - User-defined limits → JSON (`limits.json`) — Bundle 2 surfaces.
//   - Turn history → SQLite (separate module · BudgetHistoryStore).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import { migrateLegacyXdgSubdir } from '../storage/legacy-monad-dir-migrate.js';
import { ConsecutiveFailureGate } from './failure-gate.js';
import { BudgetHistoryStore, getBudgetHistoryStore } from './history-store.js';
import type {
  TurnSummary,
  UsageProvider,
  UsageSnapshot,
  WindowKind,
} from './types.js';

export interface ProviderFetcher {
  /** Called by `UsageStore.refresh()` on every refresh tick. Must
   *  throw on failure so the store can route through the failure
   *  gate; returning a snapshot = success. */
  fetch(): Promise<UsageSnapshot>;
}

export interface UsageStoreOpts {
  /** Storage root — default `~/.config/monad/budget/`. Tests override
   *  with a tmp dir. */
  readonly storageDir?: string;
  /** Override history store (tests inject a tmp-backed instance). */
  readonly historyStore?: BudgetHistoryStore;
  /** Clock injection for tests — default `Date.now`. */
  readonly now?: () => number;
}

/** Subscriber callback fired after every state mutation (snapshot
 *  commit · error commit · turn recorded). Widget code + LLM tool
 *  formatters subscribe; refresh() batches notifications so one
 *  fetch-group produces at most one notify. */
export type UsageStoreListener = () => void;

interface PersistedState {
  readonly v: 1;
  readonly snapshots: Record<string, UsageSnapshot>;
  readonly errors: Record<string, string>;
  readonly lastFetchAt: Record<string, number>;
}

// Phase 1 (PLAN-config-unification-monad-root-2026-05-10):
//   moved from ~/.config/monad/budget → ~/.monad/budget ·
//   first construction migrates legacy XDG dir (incl. SQLite WAL set).
function defaultStorageDir(): string {
  migrateLegacyXdgSubdir('budget');
  return join(monadStateRoot(), 'budget');
}
const STATE_FILENAME = 'state.json';

export class UsageStore {
  private readonly storageDir: string;
  private readonly statePath: string;
  private readonly history: BudgetHistoryStore;
  private readonly now: () => number;

  private readonly snapshots = new Map<UsageProvider, UsageSnapshot>();
  private readonly errors = new Map<UsageProvider, string>();
  private readonly lastFetchAt = new Map<UsageProvider, number>();
  private readonly fetchers = new Map<UsageProvider, ProviderFetcher>();
  private readonly gates = new Map<UsageProvider, ConsecutiveFailureGate>();
  private readonly listeners = new Set<UsageStoreListener>();

  private refreshingProviders = new Set<UsageProvider>();
  private pendingNotify = false;

  constructor(opts: UsageStoreOpts = {}) {
    this.storageDir = opts.storageDir ?? defaultStorageDir();
    this.statePath = join(this.storageDir, STATE_FILENAME);
    this.history = opts.historyStore ?? getBudgetHistoryStore();
    this.now = opts.now ?? (() => Date.now());
    this.ensureStorageDir();
    this.loadPersistedState();
  }

  // ─── Fetcher registration ──────────────────────────────────────────

  registerFetcher(provider: UsageProvider, fetcher: ProviderFetcher): void {
    this.fetchers.set(provider, fetcher);
    if (!this.gates.has(provider)) {
      this.gates.set(provider, new ConsecutiveFailureGate());
    }
    if (debug.enabled) {
      debug.log('budget.store.register', provider, { providers: [...this.fetchers.keys()] });
    }
  }

  unregisterFetcher(provider: UsageProvider): void {
    this.fetchers.delete(provider);
    this.gates.delete(provider);
  }

  // ─── Refresh ───────────────────────────────────────────────────────

  /** Run one or all registered fetchers. Failures flow through the
   *  per-provider ConsecutiveFailureGate — a single flake while we
   *  still have a prior snapshot is swallowed; subsequent flakes or
   *  flakes with no prior data surface via `errors`. */
  async refresh(provider?: UsageProvider): Promise<void> {
    const targets = provider
      ? (this.fetchers.has(provider) ? [provider] : [])
      : [...this.fetchers.keys()];
    if (targets.length === 0) return;

    await Promise.all(targets.map((p) => this.refreshOne(p)));
    this.flushNotify();
  }

  private async refreshOne(provider: UsageProvider): Promise<void> {
    const fetcher = this.fetchers.get(provider);
    if (!fetcher) return;
    if (this.refreshingProviders.has(provider)) return;
    this.refreshingProviders.add(provider);
    try {
      const snapshot = await fetcher.fetch();
      this.snapshots.set(provider, snapshot);
      this.errors.delete(provider);
      this.lastFetchAt.set(provider, this.now());
      this.gates.get(provider)?.recordSuccess();
      this.pendingNotify = true;
      if (debug.enabled) {
        debug.log('budget.store.refresh.ok', provider, {
          source: snapshot.source,
          windows: snapshot.windows.length,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hadPrior = this.snapshots.has(provider);
      const gate = this.gates.get(provider);
      const surface = gate
        ? gate.shouldSurfaceError(hadPrior)
        : true;
      this.lastFetchAt.set(provider, this.now());
      if (surface) {
        this.errors.set(provider, msg);
        this.pendingNotify = true;
      }
      if (debug.enabled) {
        debug.log('budget.store.refresh.fail', provider, {
          surface,
          streak: gate?.streak,
          message: msg.slice(0, 200),
        }, { level: 'error' });
      }
    } finally {
      this.refreshingProviders.delete(provider);
    }
    this.persistState();
  }

  // ─── Turn recording ────────────────────────────────────────────────

  /** Forward one observed turn into the history store. Dedup is the
   *  history store's concern (INSERT OR IGNORE on turnId). */
  recordTurn(turn: TurnSummary): boolean {
    const appended = this.history.appendTurn(turn);
    if (appended) {
      this.pendingNotify = true;
      this.flushNotify();
    }
    return appended;
  }

  recordTurns(turns: readonly TurnSummary[]): number {
    const n = this.history.appendTurns(turns);
    if (n > 0) {
      this.pendingNotify = true;
      this.flushNotify();
    }
    return n;
  }

  // ─── Accessors ─────────────────────────────────────────────────────

  getSnapshot(provider: UsageProvider): UsageSnapshot | undefined {
    return this.snapshots.get(provider);
  }

  getError(provider: UsageProvider): string | undefined {
    return this.errors.get(provider);
  }

  getLastFetchAt(provider: UsageProvider): number | undefined {
    return this.lastFetchAt.get(provider);
  }

  listProviders(): UsageProvider[] {
    return [...this.fetchers.keys()];
  }

  /** Sum `used` across all RateWindows matching (brand?, windowKind)
   *  in the current snapshot. Used by LLM tool + slash to give a
   *  single number instead of per-window breakdown when only one is
   *  relevant. */
  getAggregateUsed(opts: { provider?: UsageProvider; window: WindowKind }): number {
    const snapshots = opts.provider
      ? ([this.snapshots.get(opts.provider)].filter(Boolean) as UsageSnapshot[])
      : [...this.snapshots.values()];
    let total = 0;
    for (const snap of snapshots) {
      for (const w of snap.windows) {
        if (w.kind === opts.window) total += w.used;
      }
    }
    return total;
  }

  // ─── Subscribers ───────────────────────────────────────────────────

  subscribe(listener: UsageStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private flushNotify(): void {
    if (!this.pendingNotify) return;
    this.pendingNotify = false;
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        if (debug.enabled) {
          debug.log('budget.store.listener.error', 'notify', {
            message: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
    }
  }

  // ─── Persistence ───────────────────────────────────────────────────

  private ensureStorageDir(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadPersistedState(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.v !== 1) return;
      for (const [k, v] of Object.entries(parsed.snapshots ?? {})) {
        this.snapshots.set(k as UsageProvider, v);
      }
      for (const [k, v] of Object.entries(parsed.errors ?? {})) {
        this.errors.set(k as UsageProvider, v);
      }
      for (const [k, v] of Object.entries(parsed.lastFetchAt ?? {})) {
        this.lastFetchAt.set(k as UsageProvider, v);
      }
    } catch (err) {
      if (debug.enabled) {
        debug.log('budget.store.state.load-fail', this.statePath, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private persistState(): void {
    const payload: PersistedState = {
      v: 1,
      snapshots: Object.fromEntries(this.snapshots),
      errors: Object.fromEntries(this.errors),
      lastFetchAt: Object.fromEntries(this.lastFetchAt),
    };
    const tmp = `${this.statePath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, this.statePath);
    } catch (err) {
      if (debug.enabled) {
        debug.log('budget.store.state.persist-fail', this.statePath, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
}

// ─── Module-level singleton (production) ─────────────────────────────

let _instance: UsageStore | null = null;

export function getUsageStore(): UsageStore {
  if (!_instance) _instance = new UsageStore();
  return _instance;
}

export function _resetUsageStoreForTesting(): void {
  _instance = null;
}

/** Test seam · inject a pre-built store so LLM tool dispatchers that
 *  call `getUsageStore()` see the tmp-backed instance. */
export function _setUsageStoreForTesting(store: UsageStore): void {
  _instance = store;
}
