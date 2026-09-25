import { describe, expect, it } from 'bun:test';
import {
  LLM_TIER_MAP_BY_PROVIDER,
  TIER_PROVIDERS,
  type LlmTierProvider,
} from './llm-tier-map.js';
import { tierToModel, type TierModelCatalog } from './tier-to-model.js';
import { MODEL_TIERS } from './types.js';

describe('tierToModel', () => {
  it('derives every catalog model id, including wip entries', () => {
    let resolved = 0;

    for (const provider of TIER_PROVIDERS) {
      for (const tier of MODEL_TIERS) {
        expect(tierToModel(provider, tier)).toBe(LLM_TIER_MAP_BY_PROVIDER[provider][tier].model);
        resolved += 1;
      }
    }

    expect(resolved).toBeGreaterThan(0);
    expect(resolved).toBe(TIER_PROVIDERS.length * MODEL_TIERS.length);
  });

  it('returns undefined for an unknown provider without a fallback', () => {
    expect(tierToModel('unknown-provider', 'best')).toBeUndefined();
  });

  it('returns undefined when an injected catalog omits a provider', () => {
    const catalog: TierModelCatalog = {
      anthropic: LLM_TIER_MAP_BY_PROVIDER.anthropic,
    };

    expect(tierToModel('openai', 'best', catalog)).toBeUndefined();
  });

  it('returns undefined when an injected provider catalog omits a tier', () => {
    const catalog: TierModelCatalog = {
      anthropic: {
        budget: LLM_TIER_MAP_BY_PROVIDER.anthropic.budget,
      },
    };

    expect(tierToModel('anthropic' satisfies LlmTierProvider, 'best', catalog)).toBeUndefined();
  });
});
