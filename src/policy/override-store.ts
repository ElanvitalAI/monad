// H6 P3 Bundle 1 · 4-scope override store.
//
// Scope priority (higher wins · §D3 + §D9):
//   100  session-lock        process-memory · cleared on restart
//    90  per-turn            request-scoped · `RouteContext.preferred`
//    20  persistent-default  JSON-backed · `/route default`
//        throttle-bypass     R3-suppression only · (brand, window) keyed
//                            · persisted · auto-pruned on load + on
//                              getView() when expiresAt passed
//
// Storage shape (`~/.config/monad/policy/overrides.json`):
//   {
//     "v": 1,
//     "persistentDefault": { "brand": "...", "model": "..." }?,
//     "throttleBypasses": [ ... ]
//   }
//
// Session-lock is intentionally NOT persisted — if a user locks to
// Opus for a gnarly bug and then closes the terminal, they almost
// certainly want the lock to end with the session. Persistent lock
// is what `/route default` is for.

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
import type {
  OverrideView,
  ThrottleBypass,
} from './types.js';
import type { UsageProvider, WindowKind } from '../budget/types.js';

// Phase 1 (PLAN-config-unification-monad-root-2026-05-10):
//   moved from ~/.config/monad/policy → ~/.monad/policy ·
//   first construction migrates legacy XDG dir if present.
function defaultStorageDir(): string {
  migrateLegacyXdgSubdir('policy');
  return join(monadStateRoot(), 'policy');
}
const OVERRIDES_FILENAME = 'overrides.json';

const VALID_PROVIDERS: readonly UsageProvider[] = ['codex', 'claude', 'gemini', 'local-llm'];
const VALID_WINDOWS: readonly WindowKind[] = ['session', 'weekly', 'monthly'];

interface PersistedOverrides {
  readonly v: 1;
  readonly persistentDefault?: { brand: UsageProvider; model?: string };
  readonly throttleBypasses?: readonly ThrottleBypass[];
}

export interface SetPersistentResult {
  readonly saved: boolean;
  /** True when the caller set `persistent-default = local-llm` before
   *  H6 P2 landed. UI surfaces this as a warning (§C1). */
  readonly localLLMWarning: boolean;
  readonly previous?: { brand: UsageProvider; model?: string };
}

export interface OverrideStoreOpts {
  readonly storageDir?: string;
  readonly now?: () => number;
  /** Inject the current "is local-llm really usable" flag at construct
   *  time; PolicyRouter bootstrap flips this when H6 P2 lands. If
   *  unset the store assumes `false` (pre-H6 P2 behaviour). */
  readonly hasLocalLLM?: () => boolean;
}

export class OverrideStore {
  private readonly storageDir: string;
  private readonly path: string;
  private readonly now: () => number;
  private readonly hasLocalLLM: () => boolean;

  private sessionLock: { brand: UsageProvider; model?: string; setAt: number } | undefined;
  private perTurn: { brand: UsageProvider; model?: string } | undefined;
  private persistentDefault: { brand: UsageProvider; model?: string } | undefined;
  private throttleBypasses: ThrottleBypass[] = [];

  constructor(opts: OverrideStoreOpts = {}) {
    this.storageDir = opts.storageDir ?? defaultStorageDir();
    this.path = join(this.storageDir, OVERRIDES_FILENAME);
    this.now = opts.now ?? (() => Date.now());
    this.hasLocalLLM = opts.hasLocalLLM ?? (() => false);
    this.load();
  }

  // ─── Session-lock (memory only) ────────────────────────────────────

  setSessionLock(brand: UsageProvider, model?: string): void {
    if (!VALID_PROVIDERS.includes(brand)) {
      throw new Error(`session-lock: invalid brand "${brand}"`);
    }
    this.sessionLock = { brand, setAt: this.now(), ...(model ? { model } : {}) };
    if (debug.enabled) {
      debug.log('policy.override.session-lock.set', brand, { model });
    }
  }

  clearSessionLock(): void {
    this.sessionLock = undefined;
    if (debug.enabled) debug.log('policy.override.session-lock.clear', '—', {});
  }

  // ─── Per-turn (request-scoped) ─────────────────────────────────────

  setPerTurn(brand: UsageProvider, model?: string): void {
    if (!VALID_PROVIDERS.includes(brand)) {
      throw new Error(`per-turn: invalid brand "${brand}"`);
    }
    this.perTurn = { brand, ...(model ? { model } : {}) };
  }

  clearPerTurn(): void {
    this.perTurn = undefined;
  }

  // ─── Persistent default (JSON) ─────────────────────────────────────

  setPersistentDefault(brand: UsageProvider, model?: string): SetPersistentResult {
    if (!VALID_PROVIDERS.includes(brand)) {
      throw new Error(`persistent-default: invalid brand "${brand}"`);
    }
    const prior = this.persistentDefault;
    this.persistentDefault = { brand, ...(model ? { model } : {}) };
    this.persist();
    const localLLMWarning = brand === 'local-llm' && !this.hasLocalLLM();
    if (debug.enabled) {
      debug.log('policy.override.persistent.set', brand, { model, localLLMWarning });
    }
    return {
      saved: true,
      localLLMWarning,
      ...(prior ? { previous: prior } : {}),
    };
  }

  clearPersistentDefault(): { cleared: boolean } {
    const cleared = this.persistentDefault !== undefined;
    this.persistentDefault = undefined;
    if (cleared) this.persist();
    return { cleared };
  }

  // ─── Throttle bypass ───────────────────────────────────────────────

  /** Add a bypass. `expiresAt` should be the target window's resetsAt
   *  so the bypass auto-lapses on reset. Duplicate (brand, model?,
   *  window) tuples are collapsed — latest wins. */
  addThrottleBypass(bypass: Omit<ThrottleBypass, 'createdAt'> & { createdAt?: number }): ThrottleBypass {
    if (!VALID_PROVIDERS.includes(bypass.brand)) {
      throw new Error(`bypass: invalid brand "${bypass.brand}"`);
    }
    if (!VALID_WINDOWS.includes(bypass.window)) {
      throw new Error(`bypass: invalid window "${bypass.window}"`);
    }
    if (!Number.isFinite(bypass.expiresAt) || bypass.expiresAt <= this.now()) {
      throw new Error(`bypass: expiresAt must be a future epoch ms · got ${bypass.expiresAt}`);
    }
    const entry: ThrottleBypass = {
      brand: bypass.brand,
      window: bypass.window,
      expiresAt: bypass.expiresAt,
      createdAt: bypass.createdAt ?? this.now(),
      ...(bypass.model ? { model: bypass.model } : {}),
      ...(bypass.reason ? { reason: bypass.reason } : {}),
    };
    this.throttleBypasses = [
      ...this.throttleBypasses.filter((b) => !sameBypassKey(b, entry)),
      entry,
    ];
    this.persist();
    if (debug.enabled) {
      debug.log('policy.override.bypass.add', entry.brand, {
        model: entry.model,
        window: entry.window,
        expiresAt: entry.expiresAt,
      });
    }
    return entry;
  }

  clearThrottleBypasses(): number {
    const n = this.throttleBypasses.length;
    this.throttleBypasses = [];
    if (n > 0) this.persist();
    return n;
  }

  /** Check whether a `(brand, model?, window)` query has an active
   *  bypass. Model match is strict: a `claude/opus` bypass does NOT
   *  cover a `claude/sonnet` request. A bypass with `model` undefined
   *  matches any model on the same brand+window. */
  hasActiveBypass(brand: UsageProvider, window: WindowKind, model?: string): boolean {
    const now = this.now();
    return this.throttleBypasses.some(
      (b) =>
        b.brand === brand &&
        b.window === window &&
        b.expiresAt > now &&
        (b.model === undefined || b.model === model),
    );
  }

  // ─── View assembly ─────────────────────────────────────────────────

  getView(): OverrideView {
    this.pruneExpired();
    return {
      ...(this.sessionLock ? { sessionLock: this.sessionLock } : {}),
      ...(this.perTurn ? { perTurn: this.perTurn } : {}),
      ...(this.persistentDefault ? { persistentDefault: this.persistentDefault } : {}),
      throttleBypasses: [...this.throttleBypasses],
    };
  }

  listThrottleBypasses(): ThrottleBypass[] {
    this.pruneExpired();
    return [...this.throttleBypasses];
  }

  // ─── Persistence ───────────────────────────────────────────────────

  private pruneExpired(): void {
    const now = this.now();
    const before = this.throttleBypasses.length;
    this.throttleBypasses = this.throttleBypasses.filter((b) => b.expiresAt > now);
    if (this.throttleBypasses.length !== before) {
      this.persist();
      if (debug.enabled) {
        debug.log('policy.override.bypass.prune', 'expired', {
          removed: before - this.throttleBypasses.length,
        });
      }
    }
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedOverrides>;
      if (parsed.v !== 1) return;
      if (parsed.persistentDefault && VALID_PROVIDERS.includes(parsed.persistentDefault.brand)) {
        this.persistentDefault = parsed.persistentDefault.model
          ? { brand: parsed.persistentDefault.brand, model: parsed.persistentDefault.model }
          : { brand: parsed.persistentDefault.brand };
      }
      if (Array.isArray(parsed.throttleBypasses)) {
        const now = this.now();
        for (const raw of parsed.throttleBypasses) {
          if (!isValidBypass(raw)) continue;
          if (raw.expiresAt <= now) continue; // auto-prune stale
          this.throttleBypasses.push(raw);
        }
      }
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.override.load-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private persist(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    const payload: PersistedOverrides = {
      v: 1,
      ...(this.persistentDefault ? { persistentDefault: this.persistentDefault } : {}),
      throttleBypasses: this.throttleBypasses,
    };
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.override.persist-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sameBypassKey(a: ThrottleBypass, b: ThrottleBypass): boolean {
  return a.brand === b.brand && a.window === b.window && (a.model ?? '*') === (b.model ?? '*');
}

function isValidBypass(x: unknown): x is ThrottleBypass {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<ThrottleBypass>;
  return (
    typeof b.brand === 'string' &&
    VALID_PROVIDERS.includes(b.brand as UsageProvider) &&
    typeof b.window === 'string' &&
    VALID_WINDOWS.includes(b.window as WindowKind) &&
    typeof b.expiresAt === 'number' &&
    Number.isFinite(b.expiresAt) &&
    typeof b.createdAt === 'number' &&
    Number.isFinite(b.createdAt)
  );
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance: OverrideStore | null = null;

export function getOverrideStore(): OverrideStore {
  if (!_instance) _instance = new OverrideStore();
  return _instance;
}

export function _resetOverrideStoreForTesting(): void {
  _instance = null;
}

export function _setOverrideStoreForTesting(store: OverrideStore): void {
  _instance = store;
}
