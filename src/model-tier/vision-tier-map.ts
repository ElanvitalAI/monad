// M3-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Vision tier → provider/model mapping.
//
// Vision powers OCR · screenshot analysis · note-from-image. Provider-
// agnostic 5-tick slider; resolver routes per active provider.
//
//   Tier      | Anthropic                | OpenAI               | Gemini              | Local
//   --------- | ------------------------ | -------------------- | ------------------- | ----------
//   budget    | claude-haiku-4-5         | gpt-4o-mini          | gemini-flash-2.5    | llava-7b
//   balanced  | claude-haiku-4-5         | gpt-4o-mini          | gemini-flash-2.5    | llava-7b
//   better    | claude-sonnet-4-6        | gpt-4o               | gemini-pro-2.5      | llava-13b
//   best      | claude-opus-4-7          | gpt-5.4-vision       | gemini-pro-thinking | llava-34b
//   loaded    | claude-opus-4-7          | gpt-5.4-vision +     | gemini-pro-thinking | llava-34b
//             | + extended thinking      | reasoning verbose    | + multi-turn        | + caption pass
//
// "loaded" extends the best tier with reasoning depth (Anthropic
// extended thinking · OpenAI verbose · multi-turn for Gemini).

import type { ModelTier } from './types.js';

export type VisionProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'local';

export interface VisionTierSpec {
  model: string;
  /** Whether the tier appends an extra reasoning / caption pass. */
  extraReasoning: boolean;
  label: string;
  rationale: string;
  /** Approximate USD per 1M input tokens (image tokens). */
  usdPer1MTokens: number;
  status: 'shipping' | 'wip';
}

type TierMap = Readonly<Record<ModelTier, VisionTierSpec>>;

const ANTHROPIC: TierMap = {
  budget: {
    model: 'claude-haiku-4-5',
    extraReasoning: false,
    label: 'Claude Haiku 4.5',
    rationale: 'Cheap · fast OCR',
    usdPer1MTokens: 0.80,
    status: 'shipping',
  },
  balanced: {
    model: 'claude-haiku-4-5',
    extraReasoning: false,
    label: 'Claude Haiku 4.5',
    rationale: 'Default · fast multi-image',
    usdPer1MTokens: 0.80,
    status: 'shipping',
  },
  better: {
    model: 'claude-sonnet-4-6',
    extraReasoning: false,
    label: 'Claude Sonnet 4.6',
    rationale: 'Higher fidelity OCR',
    usdPer1MTokens: 3.0,
    status: 'shipping',
  },
  best: {
    model: 'claude-opus-4-7',
    extraReasoning: false,
    label: 'Claude Opus 4.7',
    rationale: 'Best image reasoning',
    usdPer1MTokens: 15.0,
    status: 'shipping',
  },
  loaded: {
    model: 'claude-opus-4-7',
    extraReasoning: true,
    label: 'Claude Opus 4.7 · extended thinking',
    rationale: 'Loaded · extended thinking on complex diagrams',
    usdPer1MTokens: 15.0,
    status: 'shipping',
  },
};

const OPENAI: TierMap = {
  budget: {
    model: 'gpt-4o-mini',
    extraReasoning: false,
    label: 'GPT-4o-mini vision',
    rationale: 'Cheap · multimodal',
    usdPer1MTokens: 0.15,
    status: 'shipping',
  },
  balanced: {
    model: 'gpt-4o-mini',
    extraReasoning: false,
    label: 'GPT-4o-mini vision',
    rationale: 'Default',
    usdPer1MTokens: 0.15,
    status: 'shipping',
  },
  better: {
    model: 'gpt-4o',
    extraReasoning: false,
    label: 'GPT-4o vision',
    rationale: 'Higher fidelity',
    usdPer1MTokens: 2.50,
    status: 'shipping',
  },
  best: {
    model: 'gpt-5.4-vision',
    extraReasoning: false,
    label: 'GPT-5.4 vision',
    rationale: 'Best · long context',
    usdPer1MTokens: 5.0,
    status: 'wip',
  },
  loaded: {
    model: 'gpt-5.4-vision',
    extraReasoning: true,
    label: 'GPT-5.4 vision · verbose reasoning',
    rationale: 'Loaded · verbose reasoning · best diagram parsing',
    usdPer1MTokens: 5.0,
    status: 'wip',
  },
};

const GEMINI: TierMap = {
  budget: {
    model: 'gemini-flash-2.5',
    extraReasoning: false,
    label: 'Gemini Flash 2.5',
    rationale: 'Cheap · fast',
    usdPer1MTokens: 0.075,
    status: 'shipping',
  },
  balanced: {
    model: 'gemini-flash-2.5',
    extraReasoning: false,
    label: 'Gemini Flash 2.5',
    rationale: 'Default',
    usdPer1MTokens: 0.075,
    status: 'shipping',
  },
  better: {
    model: 'gemini-pro-2.5',
    extraReasoning: false,
    label: 'Gemini Pro 2.5',
    rationale: 'Higher fidelity',
    usdPer1MTokens: 1.25,
    status: 'shipping',
  },
  best: {
    model: 'gemini-pro-2.5-thinking',
    extraReasoning: false,
    label: 'Gemini Pro 2.5 thinking',
    rationale: 'Best · thinking trace',
    usdPer1MTokens: 2.50,
    status: 'shipping',
  },
  loaded: {
    model: 'gemini-pro-2.5-thinking',
    extraReasoning: true,
    label: 'Gemini Pro thinking · multi-turn',
    rationale: 'Loaded · multi-turn refinement',
    usdPer1MTokens: 2.50,
    status: 'shipping',
  },
};

const LOCAL: TierMap = {
  budget: {
    model: 'llava-7b',
    extraReasoning: false,
    label: 'Ollama llava-7b',
    rationale: 'Offline · $0',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  balanced: {
    model: 'llava-7b',
    extraReasoning: false,
    label: 'Ollama llava-7b',
    rationale: 'Offline · default',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  better: {
    model: 'llava-13b',
    extraReasoning: false,
    label: 'Ollama llava-13b',
    rationale: 'Offline · higher fidelity',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  best: {
    model: 'llava-34b',
    extraReasoning: false,
    label: 'Ollama llava-34b',
    rationale: 'Best offline · 34B params',
    usdPer1MTokens: 0,
    status: 'wip',
  },
  loaded: {
    model: 'llava-34b',
    extraReasoning: true,
    label: 'Ollama llava-34b + caption pass',
    rationale: 'Loaded · 34B + caption refinement',
    usdPer1MTokens: 0,
    status: 'wip',
  },
};

export const VISION_TIER_MAP_BY_PROVIDER: Readonly<Record<VisionProvider, TierMap>> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  gemini: GEMINI,
  local: LOCAL,
};

export function lookupVisionTierSpec(
  provider: VisionProvider,
  tier: ModelTier,
): VisionTierSpec {
  return VISION_TIER_MAP_BY_PROVIDER[provider][tier];
}
