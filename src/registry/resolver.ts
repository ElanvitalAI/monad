// RFC #2161 Phase 3 — capability-aware model resolver.
//
// `resolveAvailableModels({ requires })` walks the static catalog and
// returns the models whose effective (provider ⊕ model-override)
// capabilities satisfy every clause in `requires`. The workflow-
// runtime executor calls this as a pre-flight gate so a node declaring
// `requires: { vision: 'images' }` fails fast (with a precise reason)
// when the resolved model can't satisfy it.
//
// Phase 5 (Live Registry) extends this resolver with apiKey
// availability + health + rate-limit awareness. Phase 3 ships only
// the static-catalog filter so Phase 4 (host kind rename) and Phase 5
// can land file-disjoint after this entry.

import { getCatalog } from './loader.js';
import { getLiveStore, type ProviderLiveState } from './live-store.js';
import { effectiveCapabilities, normalizeProviderId } from './normalize.js';
import type {
  Catalog,
  ModelSpec,
  ProviderCapabilities,
  ProviderRegistration,
  ToolCallingFormat,
} from './types.js';

/** Capability requirements declared by a workflow node. Subset of
 *  `ProviderCapabilities` plus a small set of model-level fields the
 *  workflow author can constrain (vision input, reasoning level,
 *  minimum context window). All clauses are AND-combined: a model
 *  satisfies `requires` iff every present clause matches. */
export interface CapabilityRequirements {
  // ── provider/model capability flags (`true` = required) ───────────
  sessionResume?: boolean;
  mcp?: boolean;
  hooks?: boolean;
  skills?: boolean;
  agents?: boolean;
  toolRestrictions?: boolean;
  structuredOutput?: boolean;
  envInjection?: boolean;
  costControl?: boolean;
  effortControl?: boolean;
  thinkingControl?: boolean;
  fallbackModel?: boolean;
  sandbox?: boolean;
  multiHostFanout?: boolean;
  // ── model-level fields ────────────────────────────────────────────
  /** Multimodal input the model must accept. `'any'` = any non-null. */
  vision?: 'images' | 'video' | 'pdf' | 'any';
  /** Minimum reasoning level the model must surface. */
  reasoning?: 'low' | 'medium' | 'high';
  /** Specific tool-call protocol; `'any'` matches any non-`'none'`. */
  toolCalling?: ToolCallingFormat | 'any';
  /** Smallest acceptable context window in tokens. */
  minContextSize?: number;
}

export interface ResolveAvailableModelsOpts {
  /** AND-combined clauses; missing fields = no constraint. */
  requires?: CapabilityRequirements;
  /** Restrict the candidate pool to a single provider id (or alias). */
  provider?: string;
  /** RFC #2161 Phase 5 — when true, also drop models whose provider's
   *  Layer B live state isn't 'available' (apiKey missing / manually
   *  disabled). 'unknown' availability (catalog provider with no
   *  apiKeyEnv) passes through so local hosts stay selectable. */
  requireAvailable?: boolean;
  /** Test seam — supply a custom live snapshot (skips singleton). */
  liveStates?: ReadonlyMap<string, ProviderLiveState>;
}

/** Per-clause rejection counter — surfaces *why* the gate filtered a
 *  candidate so error messages can name the unmet capability. */
export type ClauseRejection = Record<string, number>;

export interface ResolveAvailableModelsResult {
  /** Models whose effective capabilities satisfy every clause. */
  models: ModelSpec[];
  /** Total candidate count before filtering. */
  totalCandidates: number;
  /** clause name → number of candidates rejected by that clause. */
  rejected: ClauseRejection;
}

const REASONING_RANK: Record<'low' | 'medium' | 'high', number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const REASONING_FROM_MODEL: Record<string, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Phase 3 — pure-functional capability filter over the static catalog.
 *  Returns the models that satisfy every clause plus per-clause reject
 *  counters callers (e.g. the workflow gate) use to format actionable
 *  error messages.
 *
 *  Provider filter accepts canonical ids or aliases (`'claude'` →
 *  anthropic). Unknown provider → empty result + `provider` rejection
 *  counter so the caller can disambiguate "provider doesn't exist"
 *  from "no models satisfy the requirements". */
export function resolveAvailableModels(
  opts: ResolveAvailableModelsOpts = {},
  cat: Catalog = getCatalog(),
): ResolveAvailableModelsResult {
  const requires = opts.requires ?? {};
  const rejected: ClauseRejection = {};
  let provider: ProviderRegistration | null = null;
  if (opts.provider) {
    const canonical = normalizeProviderId(opts.provider, cat);
    if (!canonical) {
      return { models: [], totalCandidates: 0, rejected: { provider: 1 } };
    }
    provider = cat.providers.get(canonical) ?? null;
  }

  const candidates: ModelSpec[] = [];
  for (const model of cat.models.values()) {
    if (provider && model.provider !== provider.id) continue;
    candidates.push(model);
  }

  // RFC #2161 Phase 5 — apply Layer B (live state) gating before
  // capability filtering so the rejection counters surface the most
  // actionable reason (a live disable beats a capability mismatch).
  let liveById: ReadonlyMap<string, ProviderLiveState> | null = null;
  if (opts.requireAvailable) {
    liveById = opts.liveStates
      ?? new Map(getLiveStore().list().map((s) => [s.id, s] as const));
  }

  const models = candidates.filter((model) => {
    if (liveById) {
      const live = liveById.get(model.provider);
      if (live && live.availability !== 'available' && live.availability !== 'unknown') {
        bump(rejected, `live:${live.availability}`);
        return false;
      }
    }
    const eff = effectiveCapabilities(model.provider, model.id, cat);
    if (!eff) {
      bump(rejected, 'provider-missing');
      return false;
    }
    const unmet = firstUnmet(model, eff, requires);
    if (unmet) {
      bump(rejected, unmet);
      return false;
    }
    return true;
  });

  return { models, totalCandidates: candidates.length, rejected };
}

function firstUnmet(
  model: ModelSpec,
  eff: ProviderCapabilities,
  req: CapabilityRequirements,
): string | null {
  // Provider/model capability flags.
  for (const key of CAP_FLAGS) {
    const need = req[key];
    if (need !== true) continue;
    if (!eff[key]) return key;
  }
  // Model-level: vision.
  if (req.vision) {
    const v = model.vision ?? null;
    if (req.vision === 'any') {
      if (v === null) return 'vision';
    } else if (v !== req.vision) {
      return 'vision';
    }
  }
  // Model-level: reasoning floor.
  if (req.reasoning) {
    const need = REASONING_RANK[req.reasoning];
    const have = REASONING_FROM_MODEL[(model.reasoning ?? 'off') as string] ?? 0;
    if (have < need) return 'reasoning';
  }
  // Model-level: toolCalling.
  if (req.toolCalling) {
    const have = model.toolCalling ?? 'none';
    if (req.toolCalling === 'any') {
      if (have === 'none') return 'toolCalling';
    } else if (have !== req.toolCalling) {
      return 'toolCalling';
    }
  }
  // Model-level: minContextSize.
  if (typeof req.minContextSize === 'number') {
    const have = model.contextSize ?? 0;
    if (have < req.minContextSize) return 'minContextSize';
  }
  return null;
}

function bump(counter: ClauseRejection, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

const CAP_FLAGS = [
  'sessionResume',
  'mcp',
  'hooks',
  'skills',
  'agents',
  'toolRestrictions',
  'structuredOutput',
  'envInjection',
  'costControl',
  'effortControl',
  'thinkingControl',
  'fallbackModel',
  'sandbox',
  'multiHostFanout',
] as const satisfies readonly (keyof ProviderCapabilities)[];

/** Workflow gate convenience — given a (provider, model) pair already
 *  resolved by inheritance, return either `null` (gate passes) or a
 *  human-readable reason listing the first unmet clause. Phase 3 only
 *  inspects the static catalog; Phase 5 will tighten this with live
 *  apiKey / health gating. */
export function checkModelRequires(
  providerId: string | undefined | null,
  modelId: string | undefined | null,
  requires: CapabilityRequirements | undefined,
  cat: Catalog = getCatalog(),
): string | null {
  if (!requires) return null;
  if (!modelId) {
    // Cannot enforce requires without a concrete model — be permissive
    // here so workflows that lean on default-model resolution still
    // run. Phase 5 closes this gap by resolving defaults via Live
    // Registry before the gate fires.
    return null;
  }
  const canonical = providerId ? normalizeProviderId(providerId, cat) ?? providerId : undefined;
  const model = cat.models.get(modelId.toLowerCase().trim());
  if (!model) {
    // Unknown model id — fall back to provider default capabilities so
    // a typo doesn't masquerade as "no requirements". When even the
    // provider is unknown we can't say anything useful; let it through
    // and let the LLM call surface the failure directly.
    if (!canonical) return null;
    const provider = cat.providers.get(canonical);
    if (!provider) return null;
    const eff = provider.capabilities;
    return capsReason(eff, requires);
  }
  const eff = effectiveCapabilities(canonical ?? model.provider, model.id, cat);
  if (!eff) return null;
  const unmet = firstUnmet(model, eff, requires);
  return unmet ? formatReason(unmet, requires, model) : null;
}

function capsReason(
  eff: ProviderCapabilities,
  req: CapabilityRequirements,
): string | null {
  for (const key of CAP_FLAGS) {
    if (req[key] === true && !eff[key]) {
      return `provider does not advertise capability '${key}'`;
    }
  }
  return null;
}

/** RFC #2161 Phase 8 (2026-05-11) — pick a sensible default model for
 *  a provider straight from the catalog. Picks the newest non-
 *  deprecated entry by `releaseDate`; ties break alphabetically by
 *  id. Returns `null` when the provider has no registered models
 *  (e.g. `local`). Replaces the hand-curated PROVIDER_DEFAULT_MODEL_MAP
 *  in src/index.ts so adding a new model to the catalog automatically
 *  updates the default. */
export function defaultModelFor(
  providerId: string,
  cat: Catalog = getCatalog(),
): ModelSpec | null {
  const canonical = normalizeProviderId(providerId, cat);
  if (!canonical) return null;
  // ⛔ 2026-09-23 — 발견 파생 provider(게이트웨이 · `catalogFromDiscovery`)는 수백 벤더가 섞여
  //   「출시일 최신」이 기본값의 뜻을 갖지 않는다(openrouter 454개 중 임의의 새 모델이 박힌다).
  //   null 을 돌려 호출자의 문서화된 폴백(= provider 자체 기본 · 사다리 balanced)으로 보낸다.
  if (cat.providers.get(canonical)?.catalogFromDiscovery) return null;
  let best: ModelSpec | null = null;
  for (const m of cat.models.values()) {
    if (m.provider !== canonical) continue;
    if (m.deprecated != null) continue;
    if (!best) { best = m; continue; }
    const a = m.releaseDate ?? '';
    const b = best.releaseDate ?? '';
    if (a > b) { best = m; continue; }
    if (a === b && m.id < best.id) best = m;
  }
  return best;
}

function formatReason(
  clause: string,
  req: CapabilityRequirements,
  model: ModelSpec,
): string {
  if (clause === 'vision') {
    return `model '${model.id}' does not accept vision input '${req.vision}'`;
  }
  if (clause === 'reasoning') {
    return `model '${model.id}' reasoning='${model.reasoning ?? 'off'}' < required '${req.reasoning}'`;
  }
  if (clause === 'toolCalling') {
    return `model '${model.id}' toolCalling='${model.toolCalling ?? 'none'}' ≠ required '${req.toolCalling}'`;
  }
  if (clause === 'minContextSize') {
    return `model '${model.id}' context=${model.contextSize ?? 0} < required ${req.minContextSize}`;
  }
  return `model '${model.id}' does not satisfy capability '${clause}'`;
}
