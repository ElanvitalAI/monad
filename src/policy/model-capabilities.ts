// H6 P3 Bundle 1 · Model capability table.
//
// Static defaults for every (brand, model) the router understands +
// user override via `~/.config/elanous/policy/capabilities.json`. The
// defaults are a 2026-04 snapshot — when a new model ships the user
// can patch `capabilities.json` without waiting for a elanous release.
//
// H6 P2 (local-llm manager) will promote local-llm models from
// `available: false` → `true`; this file needs no edits for that
// transition — the user config can toggle per-model availability.
//
// `buildCandidatesFromCapabilities(ctx)` produces the initial
// candidate pool the router feeds through the rule pipeline.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import { migrateLegacyXdgSubdir } from '../storage/legacy-elanous-dir-migrate.js';
import type {
  CandidateAvailability,
  ModelCapability,
  RouteCandidate,
  RouteContext,
} from './types.js';
import type { UsageProvider } from '../budget/types.js';

// Phase 1 (PLAN-config-unification-elanous-root-2026-05-10):
//   moved from ~/.config/elanous/policy → ~/.elanous/policy.
function defaultStorageDir(): string {
  migrateLegacyXdgSubdir('policy');
  return join(elanousStateRoot(), 'policy');
}
const CAPABILITIES_FILENAME = 'capabilities.json';

// ─── Default table (2026-04) ─────────────────────────────────────────

export const DEFAULT_CAPABILITIES: readonly ModelCapability[] = [
  // Claude — all 3.5+ models support vision (image input via tool_result
  // or user-message content arrays). Image-pipeline P1 wires this end-
  // to-end; P3 (2026-05-05) adds the 'vision' tag here so the routing
  // layer can prefer Claude when the task carries image-bearing input.
  { brand: 'claude', model: 'opus', contextWindow: 200_000, costTier: 'premium',
    strengths: ['reasoning', 'code', 'research', 'long-context', 'vision'], available: true },
  { brand: 'claude', model: 'sonnet', contextWindow: 200_000, costTier: 'mid',
    strengths: ['code', 'chat', 'reasoning', 'long-context', 'vision'], available: true },
  { brand: 'claude', model: 'haiku', contextWindow: 200_000, costTier: 'cheap',
    strengths: ['chat', 'code', 'vision'], available: true },
  // Codex (OpenAI GPT-5 family via codex CLI) — gpt-5 family supports
  // image_url through Codex Responses function_call_output ContentItem[]
  // (image-pipeline P3 wires this 2026-05-05).
  { brand: 'codex', model: 'gpt-5', contextWindow: 400_000, costTier: 'premium',
    strengths: ['code', 'reasoning', 'long-context', 'vision'], available: true },
  { brand: 'codex', model: 'gpt-5-codex', contextWindow: 400_000, costTier: 'premium',
    strengths: ['code', 'reasoning', 'vision'], available: true },
  { brand: 'codex', model: 'gpt-5-mini', contextWindow: 400_000, costTier: 'cheap',
    strengths: ['code', 'chat', 'vision'], available: true },
  // Gemini — both pro and flash have user-message vision since 2.x.
  // Gemini 3+ adds multimodal functionResponse.parts (image-pipeline
  // P3.5 wires this 2026-05-05). Vision strength tag covers both axes
  // for routing purposes; wire layer reads brand+model to pick the
  // right shape.
  { brand: 'gemini', model: 'pro', contextWindow: 1_000_000, costTier: 'mid',
    strengths: ['long-context', 'research', 'vision', 'reasoning'], available: true },
  { brand: 'gemini', model: 'flash', contextWindow: 1_000_000, costTier: 'cheap',
    strengths: ['long-context', 'chat', 'vision'], available: true },
  // Local-LLM (H6 P2 까지 stub · available=false)
  { brand: 'local-llm', model: 'qwen2.5-coder-7b', contextWindow: 32_768, costTier: 'free',
    strengths: ['code'], available: false },
  { brand: 'local-llm', model: 'llama3.2-3b', contextWindow: 131_072, costTier: 'free',
    strengths: ['chat'], available: false },
  { brand: 'local-llm', model: 'phi3.5-mini', contextWindow: 131_072, costTier: 'free',
    strengths: ['chat', 'reasoning'], available: false },
];

// ─── User override store ─────────────────────────────────────────────

interface PersistedCapabilities {
  readonly v: 1;
  readonly capabilities: readonly ModelCapability[];
}

export interface CapabilitiesStoreOpts {
  readonly storageDir?: string;
}

export class CapabilitiesStore {
  private readonly storageDir: string;
  private readonly path: string;
  /** Key = `${brand}|${model}`. Values shadow DEFAULT_CAPABILITIES. */
  private readonly overrides = new Map<string, ModelCapability>();

  constructor(opts: CapabilitiesStoreOpts = {}) {
    this.storageDir = opts.storageDir ?? defaultStorageDir();
    this.path = join(this.storageDir, CAPABILITIES_FILENAME);
    this.load();
  }

  /** Merged view: user overrides first, then defaults for (brand,
   *  model) pairs the user didn't touch. Order matches
   *  DEFAULT_CAPABILITIES so downstream sort is stable. */
  list(): ModelCapability[] {
    const out: ModelCapability[] = [];
    const seen = new Set<string>();
    for (const dflt of DEFAULT_CAPABILITIES) {
      const key = keyFor(dflt.brand, dflt.model);
      const override = this.overrides.get(key);
      out.push(override ?? dflt);
      seen.add(key);
    }
    // User-added models not in defaults · append after.
    for (const [key, cap] of this.overrides) {
      if (!seen.has(key)) out.push(cap);
    }
    return out;
  }

  get(brand: UsageProvider, model: string): ModelCapability | undefined {
    const key = keyFor(brand, model);
    return this.overrides.get(key) ?? DEFAULT_CAPABILITIES.find(
      (c) => c.brand === brand && c.model === model,
    );
  }

  /** Tests inject pre-built overrides. Production wires via JSON load. */
  setOverride(cap: ModelCapability): void {
    this.overrides.set(keyFor(cap.brand, cap.model), cap);
    this.persist();
  }

  clearOverride(brand: UsageProvider, model: string): void {
    if (this.overrides.delete(keyFor(brand, model))) {
      this.persist();
    }
  }

  // ─── Persistence ───────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedCapabilities>;
      if (parsed.v !== 1 || !Array.isArray(parsed.capabilities)) return;
      for (const cap of parsed.capabilities) {
        if (!isValidCapability(cap)) continue;
        this.overrides.set(keyFor(cap.brand, cap.model), cap);
      }
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.capabilities.load-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  private persist(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    const payload: PersistedCapabilities = {
      v: 1,
      capabilities: [...this.overrides.values()],
    };
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (err) {
      if (debug.enabled) {
        debug.log('policy.capabilities.persist-fail', this.path, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
}

// ─── Candidate construction ──────────────────────────────────────────

/** Initial candidate pool · one per available-or-stub model. The
 *  budget view drives `availability`:
 *    - `not-yet-implemented` when capability.available=false AND
 *      budget.hasLocalLLM=false (H6 P2 pre-land guard)
 *    - `budget-saturated` when recommendations[brand] === 'throttle'
 *      AND no active bypass (rule R3 handles HITL)
 *    - `unavailable` when UsageStore never produced a snapshot
 *      for that brand AND it's cloud (no snapshot = fetcher fail
 *      streak or brand unregistered)
 *    - `ok` otherwise. */
export function buildCandidatesFromCapabilities(
  ctx: RouteContext,
  caps: readonly ModelCapability[] = DEFAULT_CAPABILITIES,
): RouteCandidate[] {
  const out: RouteCandidate[] = [];
  for (const cap of caps) {
    let availability: CandidateAvailability = 'ok';
    if (!cap.available) {
      availability = cap.brand === 'local-llm' && !ctx.budget.hasLocalLLM
        ? 'not-yet-implemented'
        : 'unavailable';
    } else if (cap.brand !== 'local-llm' && !ctx.budget.snapshots.has(cap.brand)) {
      availability = 'unavailable';
    } else if (ctx.budget.recommendations.get(cap.brand) === 'throttle') {
      availability = 'budget-saturated';
    }
    out.push({
      brand: cap.brand,
      model: cap.model,
      availability,
      capability: cap,
    });
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function keyFor(brand: UsageProvider, model: string): string {
  return `${brand}|${model}`;
}

function isValidCapability(x: unknown): x is ModelCapability {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<ModelCapability>;
  return (
    typeof c.brand === 'string' &&
    typeof c.model === 'string' &&
    typeof c.contextWindow === 'number' &&
    typeof c.costTier === 'string' &&
    Array.isArray(c.strengths) &&
    typeof c.available === 'boolean'
  );
}

// ─── Singleton ───────────────────────────────────────────────────────

let _instance: CapabilitiesStore | null = null;

export function getCapabilitiesStore(): CapabilitiesStore {
  if (!_instance) _instance = new CapabilitiesStore();
  return _instance;
}

export function _resetCapabilitiesStoreForTesting(): void {
  _instance = null;
}

export function _setCapabilitiesStoreForTesting(store: CapabilitiesStore): void {
  _instance = store;
}
