// H6 P1 Bundle 2 · User-declared + brand-default limits store.
//
// Two kinds of `Limit` exist:
//   - `source: 'user-config'` — explicit override, takes precedence.
//   - `source: 'brand-default'` — ships with the app · reasonable
//     starting quotas for Plus/Pro plans (PLAN §5 D3).
//
// Key = (brand, model ?? '*', window). Storage:
//   `~/.config/monad/budget/limits.json` · atomic tmp+rename like
//   UsageStore's state.json. JSON shape keeps the file diff-friendly
//   so users can hand-edit outside monad if they prefer.
//
// `getEffectiveLimit()` is the one API every caller (forecaster ·
// LLM tool · slash) should use — it resolves user-config → brand-
// default → undefined in that order.

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
import type { Limit, UsageProvider, WindowKind } from './types.js';

// Phase 1 (PLAN-config-unification-monad-root-2026-05-10):
//   moved from ~/.config/monad/budget → ~/.monad/budget.
function defaultStorageDir(): string {
  migrateLegacyXdgSubdir('budget');
  return join(monadStateRoot(), 'budget');
}
const LIMITS_FILENAME = 'limits.json';

// ─── Brand defaults (2026-04-22 · omni-crawl verified) ───────────────
//
// Quotas below are in **percent-units** (0..100) to match the percent-
// based RateWindow shape the fetchers emit. Bundle 2's forecaster +
// LLM tools compare `used` (percent) to `quota` (percent). When
// fetchers upgrade to absolute token counts (Bundle 3+), update
// `quota` here to the raw limit and bump `source` semantics.

const BRAND_DEFAULTS: readonly Omit<Limit, 'cycleStart'>[] = [
  { brand: 'codex', window: 'session', quota: 100, source: 'brand-default' },
  { brand: 'codex', window: 'weekly', quota: 100, source: 'brand-default' },
  { brand: 'claude', window: 'session', quota: 100, source: 'brand-default' },
  { brand: 'claude', window: 'weekly', quota: 100, source: 'brand-default' },
  { brand: 'claude', window: 'weekly', model: 'sonnet', quota: 100, source: 'brand-default' },
  { brand: 'claude', window: 'weekly', model: 'opus', quota: 100, source: 'brand-default' },
  { brand: 'gemini', window: 'session', quota: 100, source: 'brand-default' },
  { brand: 'gemini', window: 'weekly', quota: 100, source: 'brand-default' },
  { brand: 'local-llm', window: 'session', quota: Number.POSITIVE_INFINITY, source: 'brand-default' },
];

// ─── Internal key helpers ────────────────────────────────────────────

function keyFor(brand: UsageProvider, window: WindowKind, model?: string): string {
  return `${brand}|${model ?? '*'}|${window}`;
}

function matches(limit: Limit, brand: UsageProvider, window: WindowKind, model?: string): boolean {
  if (limit.brand !== brand || limit.window !== window) return false;
  const limModel = limit.model ?? '*';
  const reqModel = model ?? '*';
  return limModel === reqModel;
}

// ─── Validation ──────────────────────────────────────────────────────

const VALID_WINDOWS: readonly WindowKind[] = ['session', 'weekly', 'monthly'];
const VALID_PROVIDERS: readonly UsageProvider[] = [
  'codex',
  'claude',
  'gemini',
  'local-llm',
];

export interface LimitsValidationError {
  readonly field: 'brand' | 'window' | 'quota' | 'cycleStart';
  readonly message: string;
}

export function validateLimitInput(input: {
  brand: string;
  window: string;
  quota: number;
  model?: string;
  cycleStart?: number;
}): LimitsValidationError | null {
  if (!VALID_PROVIDERS.includes(input.brand as UsageProvider)) {
    return {
      field: 'brand',
      message: `brand must be one of ${VALID_PROVIDERS.join(', ')}`,
    };
  }
  if (!VALID_WINDOWS.includes(input.window as WindowKind)) {
    return {
      field: 'window',
      message: `window must be one of ${VALID_WINDOWS.join(', ')}`,
    };
  }
  if (!Number.isFinite(input.quota) || input.quota < 0) {
    if (input.quota !== Number.POSITIVE_INFINITY) {
      return { field: 'quota', message: 'quota must be a non-negative finite number (or Infinity)' };
    }
  }
  if (input.cycleStart != null && !Number.isFinite(input.cycleStart)) {
    return { field: 'cycleStart', message: 'cycleStart must be epoch ms' };
  }
  return null;
}

// ─── Store ───────────────────────────────────────────────────────────

export interface LimitsStoreOpts {
  readonly storageDir?: string;
  readonly now?: () => number;
}

interface PersistedLimits {
  readonly v: 1;
  readonly userLimits: readonly Limit[];
}

export class LimitsStore {
  private readonly storageDir: string;
  private readonly limitsPath: string;
  private readonly now: () => number;
  private userLimits = new Map<string, Limit>();

  constructor(opts: LimitsStoreOpts = {}) {
    this.storageDir = opts.storageDir ?? defaultStorageDir();
    this.limitsPath = join(this.storageDir, LIMITS_FILENAME);
    this.now = opts.now ?? (() => Date.now());
    this.load();
  }

  /** Resolve the effective limit for a (brand, window, model?) query.
   *  Returns user override first, else brand default, else undefined. */
  getEffective(
    brand: UsageProvider,
    window: WindowKind,
    model?: string,
  ): Limit | undefined {
    const userKey = keyFor(brand, window, model);
    const user = this.userLimits.get(userKey);
    if (user) return user;
    if (model) {
      const userBrand = this.userLimits.get(keyFor(brand, window));
      if (userBrand) return userBrand;
    }
    for (const dflt of BRAND_DEFAULTS) {
      if (matches({ ...dflt, cycleStart: 0 }, brand, window, model)) {
        return { ...dflt, cycleStart: this.now() };
      }
    }
    if (model) {
      for (const dflt of BRAND_DEFAULTS) {
        if (matches({ ...dflt, cycleStart: 0 }, brand, window)) {
          return { ...dflt, cycleStart: this.now() };
        }
      }
    }
    return undefined;
  }

  /** Write a user-config limit. Validates input; throws on invalid. */
  setUserLimit(input: {
    brand: UsageProvider;
    window: WindowKind;
    quota: number;
    model?: string;
    cycleStart?: number;
  }): Limit {
    const err = validateLimitInput(input);
    if (err) {
      throw new Error(`invalid limit · ${err.field}: ${err.message}`);
    }
    const limit: Limit = {
      brand: input.brand,
      window: input.window,
      quota: input.quota,
      ...(input.model ? { model: input.model } : {}),
      cycleStart: input.cycleStart ?? this.now(),
      source: 'user-config',
    };
    this.userLimits.set(keyFor(limit.brand, limit.window, limit.model), limit);
    this.persist();
    return limit;
  }

  /** Remove a user-config limit · returns the prior value if any. */
  clearUserLimit(
    brand: UsageProvider,
    window: WindowKind,
    model?: string,
  ): Limit | undefined {
    const key = keyFor(brand, window, model);
    const prior = this.userLimits.get(key);
    if (prior) {
      this.userLimits.delete(key);
      this.persist();
    }
    return prior;
  }

  listUserLimits(): Limit[] {
    return [...this.userLimits.values()];
  }

  listEffectiveLimits(): Limit[] {
    const seen = new Set<string>();
    const out: Limit[] = [];
    for (const lim of this.userLimits.values()) {
      const key = keyFor(lim.brand, lim.window, lim.model);
      seen.add(key);
      out.push(lim);
    }
    for (const dflt of BRAND_DEFAULTS) {
      const key = keyFor(dflt.brand, dflt.window, dflt.model);
      if (seen.has(key)) continue;
      out.push({ ...dflt, cycleStart: this.now() });
    }
    return out;
  }

  // ─── Persistence ───────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.limitsPath)) return;
    try {
      const raw = readFileSync(this.limitsPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedLimits>;
      if (parsed.v !== 1 || !Array.isArray(parsed.userLimits)) return;
      for (const lim of parsed.userLimits) {
        if (!lim || typeof lim !== 'object') continue;
        const check = validateLimitInput({
          brand: String((lim as { brand?: unknown }).brand ?? ''),
          window: String((lim as { window?: unknown }).window ?? ''),
          quota: Number((lim as { quota?: unknown }).quota ?? 0),
          ...(((lim as { model?: unknown }).model as string | undefined)
            ? { model: (lim as { model?: string }).model }
            : {}),
          ...(((lim as { cycleStart?: unknown }).cycleStart as number | undefined) != null
            ? { cycleStart: (lim as { cycleStart?: number }).cycleStart }
            : {}),
        });
        if (check) continue;
        const typed = lim as Limit;
        this.userLimits.set(keyFor(typed.brand, typed.window, typed.model), typed);
      }
    } catch (err) {
      if (debug.enabled) {
        debug.log('budget.limits.load-fail', this.limitsPath, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private persist(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    const payload: PersistedLimits = {
      v: 1,
      userLimits: [...this.userLimits.values()],
    };
    const tmp = `${this.limitsPath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, this.limitsPath);
    } catch (err) {
      if (debug.enabled) {
        debug.log('budget.limits.persist-fail', this.limitsPath, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
}

// ─── Module-level singleton ──────────────────────────────────────────

let _instance: LimitsStore | null = null;

export function getLimitsStore(): LimitsStore {
  if (!_instance) _instance = new LimitsStore();
  return _instance;
}

export function _resetLimitsStoreForTesting(): void {
  _instance = null;
}

/** Test seam · inject a pre-built store. */
export function _setLimitsStoreForTesting(store: LimitsStore): void {
  _instance = store;
}
