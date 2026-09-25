// RFC #2161 Phase 3 — resolver.ts capability filter unit tests.
//
// Builds a synthetic catalog so the assertions stay tight regardless of
// what the bundled YAML adds over time.

import { describe, expect, it } from 'bun:test';
import {
  resolveAvailableModels,
  checkModelRequires,
  defaultModelFor,
  type CapabilityRequirements,
} from '../src/registry/resolver.js';
import { PROVIDER_CAPABILITIES_NONE } from '../src/registry/types.js';
import type {
  Catalog,
  ModelSpec,
  ProviderRegistration,
} from '../src/registry/types.js';

function buildCatalog(): Catalog {
  const anthropic: ProviderRegistration = {
    id: 'anthropic',
    displayName: 'Anthropic',
    aliases: ['claude'],
    modelPrefixes: ['claude-'],
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    endpointPattern: 'https://api.anthropic.com/v1/messages',
    defaultStreaming: 'sse',
    toolCallingFormat: 'native-anthropic',
    capabilities: {
      ...PROVIDER_CAPABILITIES_NONE,
      mcp: true,
      hooks: true,
      thinkingControl: true,
      sessionResume: true,
    },
    builtIn: true,
  };
  const openai: ProviderRegistration = {
    id: 'openai',
    displayName: 'OpenAI',
    aliases: ['codex'],
    modelPrefixes: ['gpt-'],
    apiKeyEnv: 'OPENAI_API_KEY',
    endpointPattern: 'https://api.openai.com/v1/chat/completions',
    defaultStreaming: 'sse',
    toolCallingFormat: 'native-openai',
    capabilities: {
      ...PROVIDER_CAPABILITIES_NONE,
      structuredOutput: true,
      effortControl: true,
    },
    builtIn: true,
  };
  const opus: ModelSpec = {
    id: 'claude-opus-4-7',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.7',
    contextSize: 1_000_000,
    vision: 'images',
    reasoning: 'high',
    toolCalling: 'native-anthropic',
  };
  const haiku: ModelSpec = {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextSize: 200_000,
    vision: null,
    reasoning: 'low',
    toolCalling: 'native-anthropic',
  };
  const gpt: ModelSpec = {
    id: 'gpt-5.5',
    provider: 'openai',
    displayName: 'GPT 5.5',
    contextSize: 1_050_000,
    vision: 'images',
    reasoning: 'medium',
    toolCalling: 'native-openai',
  };
  return {
    catalogVersion: 1,
    providers: new Map([
      [anthropic.id, anthropic],
      [openai.id, openai],
    ]),
    models: new Map([
      [opus.id, opus],
      [haiku.id, haiku],
      [gpt.id, gpt],
    ]),
    patterns: new Map(),
    manifest: {
      builtinSource: '/dev/null',
      globalSource: '/dev/null',
      fileCount: 0,
      loadedAt: new Date().toISOString(),
    },
  };
}

describe('resolveAvailableModels', () => {
  it('returns every model when no requires given', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels({}, cat);
    expect(result.models.length).toBe(3);
    expect(result.totalCandidates).toBe(3);
    expect(result.rejected).toEqual({});
  });

  it('filters by provider id (canonical)', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels({ provider: 'anthropic' }, cat);
    expect(result.models.map((m) => m.id).sort()).toEqual([
      'claude-haiku-4-5',
      'claude-opus-4-7',
    ]);
    expect(result.totalCandidates).toBe(2);
  });

  it('filters by provider alias (claude → anthropic)', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels({ provider: 'claude' }, cat);
    expect(result.models.length).toBe(2);
  });

  it('returns empty + provider rejection when provider unknown', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels({ provider: 'mistral' }, cat);
    expect(result.models).toEqual([]);
    expect(result.rejected.provider).toBe(1);
  });

  it('blocks models without required capability flag', () => {
    const cat = buildCatalog();
    const requires: CapabilityRequirements = { mcp: true };
    const result = resolveAvailableModels({ requires }, cat);
    // Only anthropic has mcp=true at provider level.
    expect(result.models.every((m) => m.provider === 'anthropic')).toBe(true);
    expect(result.rejected.mcp).toBe(1); // gpt-5.5
  });

  it('respects model-level vision constraint', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels(
      { requires: { vision: 'images' } },
      cat,
    );
    expect(result.models.map((m) => m.id).sort()).toEqual([
      'claude-opus-4-7',
      'gpt-5.5',
    ]);
    expect(result.rejected.vision).toBe(1); // haiku (vision: null)
  });

  it('reasoning floor — medium accepts medium + high', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels(
      { requires: { reasoning: 'medium' } },
      cat,
    );
    expect(result.models.map((m) => m.id).sort()).toEqual([
      'claude-opus-4-7',
      'gpt-5.5',
    ]);
    expect(result.rejected.reasoning).toBe(1); // haiku (low)
  });

  it('toolCalling exact match', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels(
      { requires: { toolCalling: 'native-openai' } },
      cat,
    );
    expect(result.models.map((m) => m.id)).toEqual(['gpt-5.5']);
    expect(result.rejected.toolCalling).toBe(2);
  });

  it('toolCalling "any" rejects "none"', () => {
    const cat = buildCatalog();
    cat.models.set('embed-only', {
      id: 'embed-only',
      provider: 'openai',
      displayName: 'Embed Only',
      toolCalling: 'none',
    } as ModelSpec);
    const result = resolveAvailableModels(
      { requires: { toolCalling: 'any' } },
      cat,
    );
    expect(result.models.find((m) => m.id === 'embed-only')).toBeUndefined();
  });

  it('minContextSize filter', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels(
      { requires: { minContextSize: 500_000 } },
      cat,
    );
    expect(result.models.map((m) => m.id).sort()).toEqual([
      'claude-opus-4-7',
      'gpt-5.5',
    ]);
    expect(result.rejected.minContextSize).toBe(1); // haiku (200k)
  });
});

describe('resolveAvailableModels · requireAvailable (Layer B gate)', () => {
  it('passes through when no live state given', () => {
    const cat = buildCatalog();
    const result = resolveAvailableModels({ requireAvailable: true, liveStates: new Map() }, cat);
    expect(result.models.length).toBe(3);
    expect(result.rejected).toEqual({});
  });

  it('drops models when provider live state = no-api-key', () => {
    const cat = buildCatalog();
    const liveStates = new Map([
      ['anthropic', {
        id: 'anthropic',
        availability: 'no-api-key' as const,
        apiKeyEnvSet: false,
        manualDisabled: false,
        observedAt: 0,
      }],
      ['openai', {
        id: 'openai',
        availability: 'available' as const,
        apiKeyEnvSet: true,
        manualDisabled: false,
        observedAt: 0,
      }],
    ]);
    const result = resolveAvailableModels(
      { requireAvailable: true, liveStates },
      cat,
    );
    expect(result.models.map((m) => m.provider)).toEqual(['openai']);
    expect(result.rejected['live:no-api-key']).toBe(2); // both claude models
  });

  it('drops disabled providers', () => {
    const cat = buildCatalog();
    const liveStates = new Map([
      ['anthropic', {
        id: 'anthropic',
        availability: 'available' as const,
        apiKeyEnvSet: true,
        manualDisabled: false,
        observedAt: 0,
      }],
      ['openai', {
        id: 'openai',
        availability: 'disabled' as const,
        apiKeyEnvSet: true,
        manualDisabled: true,
        observedAt: 0,
      }],
    ]);
    const result = resolveAvailableModels(
      { requireAvailable: true, liveStates },
      cat,
    );
    expect(result.models.map((m) => m.provider).every((p) => p === 'anthropic')).toBe(true);
    expect(result.rejected['live:disabled']).toBe(1);
  });

  it('availability=unknown still passes (e.g. local hosts)', () => {
    const cat = buildCatalog();
    const liveStates = new Map([
      ['anthropic', {
        id: 'anthropic',
        availability: 'unknown' as const,
        apiKeyEnvSet: false,
        manualDisabled: false,
        observedAt: 0,
      }],
      ['openai', {
        id: 'openai',
        availability: 'unknown' as const,
        apiKeyEnvSet: false,
        manualDisabled: false,
        observedAt: 0,
      }],
    ]);
    const result = resolveAvailableModels(
      { requireAvailable: true, liveStates },
      cat,
    );
    expect(result.models.length).toBe(3);
  });
});

describe('defaultModelFor (Phase 8)', () => {
  it('picks the newest non-deprecated model for the provider', () => {
    const cat = buildCatalog();
    cat.models.set('claude-old', {
      id: 'claude-old',
      provider: 'anthropic',
      displayName: 'Old',
      releaseDate: '2024-01-01',
    } as ModelSpec);
    cat.models.set('claude-newer', {
      id: 'claude-newer',
      provider: 'anthropic',
      displayName: 'Newer',
      releaseDate: '2026-01-01',
    } as ModelSpec);
    const winner = defaultModelFor('anthropic', cat);
    expect(winner?.id).toBe('claude-newer');
  });

  it('skips deprecated entries', () => {
    const cat = buildCatalog();
    cat.models.set('claude-newest-but-deprecated', {
      id: 'claude-newest-but-deprecated',
      provider: 'anthropic',
      displayName: 'Newest deprecated',
      releaseDate: '2099-12-31',
      deprecated: '2099-12-31',
    } as ModelSpec);
    const winner = defaultModelFor('anthropic', cat);
    expect(winner?.id).not.toBe('claude-newest-but-deprecated');
  });

  it('accepts canonical provider via alias', () => {
    const cat = buildCatalog();
    expect(defaultModelFor('claude', cat)?.provider).toBe('anthropic');
  });

  it('returns null when provider unknown', () => {
    const cat = buildCatalog();
    expect(defaultModelFor('mistral', cat)).toBe(null);
  });

  it('returns null when provider has no registered models', () => {
    const cat = buildCatalog();
    cat.providers.set('newcomer', {
      id: 'newcomer',
      displayName: 'New',
      aliases: [],
      modelPrefixes: [],
      apiKeyEnv: '',
      endpointPattern: '',
      defaultStreaming: 'sse',
      toolCallingFormat: 'none',
      capabilities: cat.providers.get('anthropic')!.capabilities,
      builtIn: false,
    });
    expect(defaultModelFor('newcomer', cat)).toBe(null);
  });
});

describe('checkModelRequires', () => {
  it('returns null when requires is undefined', () => {
    const cat = buildCatalog();
    expect(checkModelRequires('anthropic', 'claude-opus-4-7', undefined, cat)).toBe(null);
  });

  it('returns null when modelId is null (defaults will be resolved later)', () => {
    const cat = buildCatalog();
    expect(checkModelRequires('anthropic', null, { mcp: true }, cat)).toBe(null);
  });

  it('returns null when capabilities satisfy requires', () => {
    const cat = buildCatalog();
    expect(
      checkModelRequires('anthropic', 'claude-opus-4-7', { vision: 'images', mcp: true }, cat),
    ).toBe(null);
  });

  it('formats vision unmet reason', () => {
    const cat = buildCatalog();
    const reason = checkModelRequires(
      'anthropic',
      'claude-haiku-4-5',
      { vision: 'images' },
      cat,
    );
    expect(reason).toContain("does not accept vision input 'images'");
  });

  it('accepts canonical provider via alias', () => {
    const cat = buildCatalog();
    const reason = checkModelRequires('claude', 'claude-haiku-4-5', { mcp: true }, cat);
    expect(reason).toBe(null); // alias resolves to anthropic which has mcp
  });

  it('returns null when provider+model both unknown', () => {
    const cat = buildCatalog();
    expect(
      checkModelRequires('mistral', 'mistral-large', { mcp: true }, cat),
    ).toBe(null);
  });

  it('reports unmet capability when model id unknown but provider lacks the flag', () => {
    const cat = buildCatalog();
    const reason = checkModelRequires(
      'openai',
      'gpt-future-unknown',
      { mcp: true },
      cat,
    );
    expect(reason).toContain("provider does not advertise capability 'mcp'");
  });

  it('reasoning floor reports actual vs required', () => {
    const cat = buildCatalog();
    const reason = checkModelRequires(
      'anthropic',
      'claude-haiku-4-5',
      { reasoning: 'high' },
      cat,
    );
    expect(reason).toContain("reasoning='low'");
    expect(reason).toContain("required 'high'");
  });
});
