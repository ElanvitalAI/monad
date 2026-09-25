// H6 P3 Bundle 1 · Brand / model fallback chain.
//
// When rule R4 (budget-warn) fires it asks this chain: "the LLM asked
// for Claude Opus but Claude is at 82% — which candidate is the next
// best fit?". The chain is a ranked list of (brand, model?) pairs;
// the rule walks it top-to-bottom and picks the first entry that is
// (a) available (capability.available && not budget-saturated) and
// (b) not the candidate that triggered the redirect.
//
// Default chain is cost-descending so warn cascades gracefully to a
// cheaper tier before switching brand:
//   opus → sonnet → gpt-5 → gpt-5-mini → gemini pro → gemini flash
//   → local-llm (H6 P2 이후)
//
// User override via `~/.config/monad/policy/fallback.json` · same
// atomic tmp+rename pattern as limits.json.

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
import type { RouteCandidate } from './types.js';
import type { UsageProvider } from '../budget/types.js';
import type { BudgetRecommendation } from '../budget/forecaster.js';

// Phase 1 (PLAN-config-unification-monad-root-2026-05-10):
//   moved from ~/.config/monad/policy → ~/.monad/policy.
function defaultStorageDir(): string {
  migrateLegacyXdgSubdir('policy');
  return join(monadStateRoot(), 'policy');
}
const FALLBACK_FILENAME = 'fallback.json';

export interface FallbackEntry {
  readonly brand: UsageProvider;
  /** Undefined = brand-level wildcard (match any model of that brand). */
  readonly model?: string;
}

export const DEFAULT_FALLBACK_CHAIN: readonly FallbackEntry[] = [
  { brand: 'claude', model: 'opus' },
  { brand: 'claude', model: 'sonnet' },
  { brand: 'codex', model: 'gpt-5' },
  { brand: 'codex', model: 'gpt-5-codex' },
  { brand: 'codex', model: 'gpt-5-mini' },
  { brand: 'gemini', model: 'pro' },
  { brand: 'gemini', model: 'flash' },
  { brand: 'claude', model: 'haiku' },
  { brand: 'local-llm' }, // wildcard · 자동으로 "any local-llm model" 매칭
];

interface PersistedChain {
  readonly v: 1;
  readonly chain: readonly FallbackEntry[];
}

export interface FallbackChainOpts {
  readonly storageDir?: string;
}

export class FallbackChain {
  private readonly storageDir: string;
  private readonly path: string;
  private chain: readonly FallbackEntry[] = DEFAULT_FALLBACK_CHAIN;

  constructor(opts: FallbackChainOpts = {}) {
    this.storageDir = opts.storageDir ?? defaultStorageDir();
    this.path = join(this.storageDir, FALLBACK_FILENAME);
    this.load();
  }

  list(): readonly FallbackEntry[] {
    return this.chain;
  }

  setChain(chain: readonly FallbackEntry[]): void {
    this.chain = chain;
    this.persist();
  }

  resetToDefault(): void {
    this.chain = DEFAULT_FALLBACK_CHAIN;
    this.persist();
  }

  /** Pick the first chain entry that (a) matches an available
   *  candidate, (b) doesn't match the `excluded` candidate, and
   *  (c) isn't on a brand the caller is trying to step away from
   *  (`avoidBrands`). Returns undefined when exhausted. */
  pickNext(opts: {
    candidates: readonly RouteCandidate[];
    recommendations: ReadonlyMap<UsageProvider, BudgetRecommendation>;
    excluded?: RouteCandidate;
    /** Brands to skip entirely (e.g. the warn-triggering brand). If
     *  empty, only throttled brands are skipped. */
    avoidBrands?: readonly UsageProvider[];
  }): RouteCandidate | undefined {
    const { candidates, recommendations, excluded, avoidBrands = [] } = opts;
    for (const entry of this.chain) {
      for (const cand of candidates) {
        if (!entryMatches(entry, cand)) continue;
        if (excluded && sameCandidate(cand, excluded)) continue;
        if (cand.availability !== 'ok') continue;
        if (recommendations.get(cand.brand) === 'throttle') continue;
        if (avoidBrands.includes(cand.brand)) continue;
        return cand;
      }
    }
    return undefined;
  }

  // ─── Persistence ───────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedChain>;
      if (parsed.v !== 1 || !Array.isArray(parsed.chain)) return;
      const parsedChain: FallbackEntry[] = [];
      for (const entry of parsed.chain) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Partial<FallbackEntry>;
        if (typeof e.brand !== 'string') continue;
        parsedChain.push(e.model
          ? { brand: e.brand as UsageProvider, model: e.model }
          : { brand: e.brand as UsageProvider });
      }
      if (parsedChain.length > 0) this.chain = parsedChain;
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.fallback.load-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private persist(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    const payload: PersistedChain = { v: 1, chain: this.chain };
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.fallback.persist-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function entryMatches(entry: FallbackEntry, cand: RouteCandidate): boolean {
  if (entry.brand !== cand.brand) return false;
  if (entry.model === undefined) return true; // brand wildcard
  return entry.model === cand.model;
}

function sameCandidate(a: RouteCandidate, b: RouteCandidate): boolean {
  return a.brand === b.brand && (a.model ?? '*') === (b.model ?? '*');
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance: FallbackChain | null = null;

export function getFallbackChain(): FallbackChain {
  if (!_instance) _instance = new FallbackChain();
  return _instance;
}

export function _resetFallbackChainForTesting(): void {
  _instance = null;
}

export function _setFallbackChainForTesting(chain: FallbackChain): void {
  _instance = chain;
}
