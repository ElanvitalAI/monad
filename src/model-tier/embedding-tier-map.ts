// M3-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Embedding tier → provider/model mapping.
//
// Embeddings power RAG / similarity / clustering surfaces. Like LLM
// (and unlike STT) there are many providers; the 5-tick slider stays
// provider-agnostic and the resolver routes per active provider.
//
// Tier ladder (defaults):
//
//   Tier      | OpenAI                     | Voyage           | Cohere                 | Local
//   --------- | -------------------------- | ---------------- | ---------------------- | ----------
//   budget    | text-embedding-3-small     | voyage-3-lite    | embed-light-v3.0       | nomic-embed-text (Ollama)
//   balanced  | text-embedding-3-small     | voyage-3-lite    | embed-multilingual-v3  | nomic-embed-text
//   better    | text-embedding-3-large     | voyage-3         | embed-multilingual-v3  | mxbai-large
//   best      | text-embedding-3-large     | voyage-3-large   | embed-english-v3.0     | mxbai-large
//   loaded    | text-embedding-3-large +   | voyage-3-large + | embed-english-v3.0 +   | mxbai-large +
//             | 3072 dim                   | 2048 dim         | reranker pass          | reranker pass
//
// "loaded" adds a reranker pass on top of the best embedding model —
// the rationale string surfaces this to the user. Implementation of
// the reranker hook is deferred to whichever subsystem first needs it
// (RAG retrieval · semantic-search). For now the tier resolver returns
// `extraReranker: true` so callers can branch.

import type { ModelTier } from './types.js';

export type EmbeddingProvider =
  | 'openai'
  | 'voyage'
  | 'cohere'
  | 'local';

export interface EmbeddingTierSpec {
  model: string;
  /** Output vector size — used by the storage layer to size the index. */
  dim: number;
  /** Whether the tier appends a reranker stage on top of the embedding
   *  retrieve (loaded tick today). */
  extraReranker: boolean;
  label: string;
  rationale: string;
  /** Approximate USD per 1M input tokens (mirror of provider pricing
   *  · 0 for local). Kept here for the slider's monthly-cost preview. */
  usdPer1MTokens: number;
  status: 'shipping' | 'wip';
}

type TierMap = Readonly<Record<ModelTier, EmbeddingTierSpec>>;

const OPENAI: TierMap = {
  budget: {
    model: 'text-embedding-3-small',
    dim: 1536,
    extraReranker: false,
    label: 'OpenAI 3-small',
    rationale: 'Cheap · solid baseline',
    usdPer1MTokens: 0.02,
    status: 'shipping',
  },
  balanced: {
    model: 'text-embedding-3-small',
    dim: 1536,
    extraReranker: false,
    label: 'OpenAI 3-small',
    rationale: 'Default · multilingual fine',
    usdPer1MTokens: 0.02,
    status: 'shipping',
  },
  better: {
    model: 'text-embedding-3-large',
    dim: 1536,
    extraReranker: false,
    label: 'OpenAI 3-large',
    rationale: 'Higher recall · 1536-dim',
    usdPer1MTokens: 0.13,
    status: 'shipping',
  },
  best: {
    model: 'text-embedding-3-large',
    dim: 3072,
    extraReranker: false,
    label: 'OpenAI 3-large · 3072 dim',
    rationale: 'Best recall · 3072-dim',
    usdPer1MTokens: 0.13,
    status: 'shipping',
  },
  loaded: {
    model: 'text-embedding-3-large',
    dim: 3072,
    extraReranker: true,
    label: 'OpenAI 3-large · 3072 dim + reranker',
    rationale: 'Loaded · 3072-dim + reranker pass',
    usdPer1MTokens: 0.13,
    status: 'wip',
  },
};

const VOYAGE: TierMap = {
  budget: {
    model: 'voyage-3-lite',
    dim: 512,
    extraReranker: false,
    label: 'Voyage 3-lite',
    rationale: 'Cheap · solid baseline',
    usdPer1MTokens: 0.02,
    status: 'shipping',
  },
  balanced: {
    model: 'voyage-3-lite',
    dim: 512,
    extraReranker: false,
    label: 'Voyage 3-lite',
    rationale: 'Default',
    usdPer1MTokens: 0.02,
    status: 'shipping',
  },
  better: {
    model: 'voyage-3',
    dim: 1024,
    extraReranker: false,
    label: 'Voyage 3',
    rationale: 'Higher recall',
    usdPer1MTokens: 0.06,
    status: 'shipping',
  },
  best: {
    model: 'voyage-3-large',
    dim: 1024,
    extraReranker: false,
    label: 'Voyage 3-large',
    rationale: 'Best in class · 1024-dim',
    usdPer1MTokens: 0.18,
    status: 'shipping',
  },
  loaded: {
    model: 'voyage-3-large',
    dim: 2048,
    extraReranker: true,
    label: 'Voyage 3-large · 2048 dim + reranker',
    rationale: 'Loaded · 2048-dim + reranker',
    usdPer1MTokens: 0.18,
    status: 'wip',
  },
};

const COHERE: TierMap = {
  budget: {
    model: 'embed-light-v3.0',
    dim: 384,
    extraReranker: false,
    label: 'Cohere embed-light',
    rationale: 'Cheap · small',
    usdPer1MTokens: 0.01,
    status: 'shipping',
  },
  balanced: {
    model: 'embed-multilingual-v3.0',
    dim: 1024,
    extraReranker: false,
    label: 'Cohere multilingual v3',
    rationale: '100+ languages',
    usdPer1MTokens: 0.10,
    status: 'shipping',
  },
  better: {
    model: 'embed-multilingual-v3.0',
    dim: 1024,
    extraReranker: false,
    label: 'Cohere multilingual v3',
    rationale: 'Higher recall',
    usdPer1MTokens: 0.10,
    status: 'shipping',
  },
  best: {
    model: 'embed-english-v3.0',
    dim: 1024,
    extraReranker: false,
    label: 'Cohere english v3',
    rationale: 'English-specialized · best recall',
    usdPer1MTokens: 0.10,
    status: 'shipping',
  },
  loaded: {
    model: 'embed-english-v3.0',
    dim: 1024,
    extraReranker: true,
    label: 'Cohere english v3 + reranker',
    rationale: 'Loaded · english + reranker pass',
    usdPer1MTokens: 0.10,
    status: 'wip',
  },
};

const LOCAL: TierMap = {
  budget: {
    model: 'nomic-embed-text',
    dim: 768,
    extraReranker: false,
    label: 'Ollama nomic-embed',
    rationale: 'Offline · $0',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  balanced: {
    model: 'nomic-embed-text',
    dim: 768,
    extraReranker: false,
    label: 'Ollama nomic-embed',
    rationale: 'Offline · multilingual',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  better: {
    model: 'mxbai-large',
    dim: 1024,
    extraReranker: false,
    label: 'Ollama mxbai-large',
    rationale: 'Offline · higher recall',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  best: {
    model: 'mxbai-large',
    dim: 1024,
    extraReranker: false,
    label: 'Ollama mxbai-large',
    rationale: 'Best offline',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  loaded: {
    model: 'mxbai-large',
    dim: 1024,
    extraReranker: true,
    label: 'Ollama mxbai-large + reranker',
    rationale: 'Loaded · offline + reranker',
    usdPer1MTokens: 0,
    status: 'wip',
  },
};

export const EMBEDDING_TIER_MAP_BY_PROVIDER: Readonly<Record<EmbeddingProvider, TierMap>> = {
  openai: OPENAI,
  voyage: VOYAGE,
  cohere: COHERE,
  local: LOCAL,
};

export function lookupEmbeddingTierSpec(
  provider: EmbeddingProvider,
  tier: ModelTier,
): EmbeddingTierSpec {
  return EMBEDDING_TIER_MAP_BY_PROVIDER[provider][tier];
}
