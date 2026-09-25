import {
  LLM_TIER_MAP_BY_PROVIDER,
  type LlmTierProvider,
  type LlmTierSpec,
} from './llm-tier-map.js';
import type { ModelTier } from './types.js';

export type TierModelCatalog = Readonly<
  Partial<Record<LlmTierProvider, Readonly<Partial<Record<ModelTier, Pick<LlmTierSpec, 'model'>>>>>>
>;

/**
 * Resolves a concrete provider model id from an explicit tier catalog.
 * Unknown providers and missing catalog entries remain unresolved rather
 * than using the lookup helper's Codex fallback.
 */
export function tierToModel(
  provider: string,
  tier: ModelTier,
  catalog: TierModelCatalog = LLM_TIER_MAP_BY_PROVIDER,
): string | undefined {
  return catalog[provider as LlmTierProvider]?.[tier]?.model;
}
