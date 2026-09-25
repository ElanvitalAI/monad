// M1-2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 1) —
// PWA-side mirror of `src/model-tier/`.
//
// The PWA tsconfig only sees `apps/pwa/src/**` so we duplicate the
// tier vocabulary instead of importing from the parent package. The
// shapes are intentionally identical to `src/model-tier/types.ts`
// + `src/model-tier/tier-map.ts` so a future workspace-paths refactor
// can collapse them with no API breakage.
//
// Drift defense: `model-tier-spec.test.ts` asserts that every tier
// label/cost in this file matches the same key in the parent source.
// Edit both files together when adding tiers.

export type ModelTier = 'budget' | 'balanced' | 'better' | 'best' | 'loaded';

export const MODEL_TIERS: readonly ModelTier[] = [
  'budget',
  'balanced',
  'better',
  'best',
  'loaded',
] as const;

export const MODEL_TIER_LABELS: Readonly<Record<ModelTier, string>> = {
  budget: 'Budget',
  balanced: 'Balanced',
  better: 'Better',
  best: 'Best',
  loaded: 'Loaded',
} as const;

export const DEFAULT_MODEL_TIER: ModelTier = 'balanced';

export function isModelTier(v: unknown): v is ModelTier {
  return typeof v === 'string' && (MODEL_TIERS as readonly string[]).includes(v);
}

export function modelTierRank(t: ModelTier): number {
  return MODEL_TIERS.indexOf(t);
}

// ── STT tier spec (mirror of src/model-tier/tier-map.ts) ───────────

export interface SttTierSpec {
  /** Display label shown beneath the slider tick. */
  label: string;
  /** One-line strength shown on hover and on the active row. */
  rationale: string;
  /** Base USD/audio-minute. 0 for local providers. */
  usdPerMinAudio: number;
  /** Add-on USD/minute from request-level extras (loaded only). */
  loadedExtraUsdPerMin: number;
  /** Identifier of the provider that ships the tier today. */
  provider: 'openai-realtime-stt' | 'whisper-cpp-local';
  /** Provider-side model id (informational; the slider hides this from
   *  casual users but power users can read it in the tooltip). */
  model: string;
  /** `shipping` = wired end-to-end · `wip` = WIP (e.g. local binary
   *  not installed yet) · UI may grey out / advise install steps. */
  status: 'shipping' | 'wip';
}

export const STT_TIER_MAP: Readonly<Record<ModelTier, SttTierSpec>> = {
  budget: {
    label: 'Local (whisper.cpp)',
    rationale: 'Offline · $0/min · install local whisper.cpp first',
    usdPerMinAudio: 0,
    loadedExtraUsdPerMin: 0,
    provider: 'whisper-cpp-local',
    model: 'whisper.cpp',
    status: 'wip',
  },
  balanced: {
    label: 'OpenAI mini transcribe',
    rationale: 'Sensible default · streaming · $0.003/min',
    usdPerMinAudio: 0.003,
    loadedExtraUsdPerMin: 0,
    provider: 'openai-realtime-stt',
    model: 'gpt-4o-mini-transcribe',
    status: 'shipping',
  },
  better: {
    label: 'OpenAI gpt-4o transcribe',
    rationale: 'Higher accuracy · still streaming · $0.006/min',
    usdPerMinAudio: 0.006,
    loadedExtraUsdPerMin: 0,
    provider: 'openai-realtime-stt',
    model: 'gpt-4o-transcribe',
    status: 'shipping',
  },
  best: {
    label: 'OpenAI gpt-realtime-whisper',
    rationale: 'Best accuracy · domain adaptation · $0.017/min',
    usdPerMinAudio: 0.017,
    loadedExtraUsdPerMin: 0,
    provider: 'openai-realtime-stt',
    model: 'gpt-realtime-whisper',
    status: 'shipping',
  },
  loaded: {
    label: 'OpenAI gpt-realtime-whisper · loaded',
    rationale: 'Loaded · logprobs + timestamps + tightest latency · ~$0.025/min',
    usdPerMinAudio: 0.017,
    loadedExtraUsdPerMin: 0.008,
    provider: 'openai-realtime-stt',
    model: 'gpt-realtime-whisper',
    status: 'shipping',
  },
} as const;

export function sttTierEffectiveUsdPerMin(tier: ModelTier): number {
  const spec = STT_TIER_MAP[tier];
  return spec.usdPerMinAudio + spec.loadedExtraUsdPerMin;
}

// ── Monthly cost projection (mirror of cost-estimate.ts) ───────────

const DAYS_PER_MONTH = 30;

/** Project monthly USD cost at `tier` given the user's recent
 *  daily-average audio minutes. Pure / synchronous so the slider
 *  tooltip can compute it inline as the user drags. */
export function projectSttMonthlyCost(
  tier: ModelTier,
  audioMinPerDay: number,
): number {
  if (!Number.isFinite(audioMinPerDay) || audioMinPerDay <= 0) return 0;
  return audioMinPerDay * DAYS_PER_MONTH * sttTierEffectiveUsdPerMin(tier);
}

/** Format a monthly USD figure for inline display. `$0.30/mo` reads
 *  cleanly at small amounts; `$24/mo` at larger ones (skip cents
 *  past $10 so the slider tooltip stays compact). */
export function formatMonthlyUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0/mo';
  if (usd < 0.01) return '<$0.01/mo';
  if (usd < 10) return `$${usd.toFixed(2)}/mo`;
  if (usd < 100) return `$${usd.toFixed(1)}/mo`;
  return `$${Math.round(usd)}/mo`;
}

// ── LLM tier spec (mirror of src/model-tier/llm-tier-map.ts · M2-1) ──

export type LlmTierProvider =
  | 'anthropic' | 'openai' | 'gemini' | 'openai-codex' | 'local'
  | 'kimi' | 'qwen' | 'glm' | 'grok';

export type LlmReasoningLevel = 'off' | 'low' | 'medium' | 'high';

export interface LlmTierSpec {
  model: string;
  reasoningLevel?: LlmReasoningLevel;
  label: string;
  rationale: string;
  status: 'shipping' | 'wip';
}

type LlmTierMap = Readonly<Record<ModelTier, LlmTierSpec>>;

const ANTHROPIC_TIERS: LlmTierMap = {
  budget:   { model: 'claude-haiku-4-5', reasoningLevel: 'off', label: 'Claude Haiku 4.5', rationale: 'Fast · cheap · default for most chat', status: 'shipping' },
  balanced: { model: 'claude-haiku-4-5', reasoningLevel: 'off', label: 'Claude Haiku 4.5', rationale: 'Default · fast multi-turn', status: 'shipping' },
  better:   { model: 'claude-sonnet-4-6', reasoningLevel: 'low', label: 'Claude Sonnet 4.6 · reasoning low', rationale: 'Higher quality · reasoning hint', status: 'shipping' },
  best:     { model: 'claude-opus-4-7', reasoningLevel: 'medium', label: 'Claude Opus 4.7 · reasoning medium', rationale: 'Best reasoning · longer plans', status: 'shipping' },
  loaded:   { model: 'claude-opus-4-7', reasoningLevel: 'high', label: 'Claude Opus 4.7 · extended thinking', rationale: 'Loaded · extended thinking · multi-step depth', status: 'shipping' },
};

const OPENAI_TIERS: LlmTierMap = {
  budget:   { model: 'gpt-4o-mini', reasoningLevel: 'off', label: 'GPT-4o-mini', rationale: 'Fast · cheap', status: 'shipping' },
  balanced: { model: 'gpt-4o-mini', reasoningLevel: 'off', label: 'GPT-4o-mini', rationale: 'Default · multi-turn', status: 'shipping' },
  better:   { model: 'gpt-4o', reasoningLevel: 'off', label: 'GPT-4o', rationale: 'Higher quality · multimodal', status: 'shipping' },
  best:     { model: 'o1', reasoningLevel: 'medium', label: 'o1 · reasoning medium', rationale: 'Best reasoning · slower', status: 'shipping' },
  loaded:   { model: 'o1', reasoningLevel: 'high', label: 'o1 · reasoning high', rationale: 'Loaded · deep multi-step reasoning', status: 'shipping' },
};

const GEMINI_TIERS: LlmTierMap = {
  budget:   { model: 'gemini-2.5-flash', reasoningLevel: 'off', label: 'Gemini 2.5 Flash', rationale: 'Fast · cheap', status: 'shipping' },
  balanced: { model: 'gemini-2.5-flash', reasoningLevel: 'off', label: 'Gemini 2.5 Flash', rationale: 'Default · low-latency', status: 'shipping' },
  better:   { model: 'gemini-2.5-pro', reasoningLevel: 'off', label: 'Gemini 2.5 Pro', rationale: 'Higher quality · larger context', status: 'shipping' },
  best:     { model: 'gemini-2.5-pro', reasoningLevel: 'medium', label: 'Gemini 2.5 Pro · thinking', rationale: 'Pro with reasoning hint', status: 'shipping' },
  loaded:   { model: 'gemini-2.5-pro', reasoningLevel: 'high', label: 'Gemini 2.5 Pro · deep thinking', rationale: 'Loaded · deep reasoning · slowest', status: 'shipping' },
};

const CODEX_TIERS: LlmTierMap = {
  budget:   { model: 'codex-mini', reasoningLevel: 'off', label: 'codex-mini', rationale: 'Light tasks · ChatGPT OAuth', status: 'shipping' },
  balanced: { model: 'gpt-5.4', reasoningLevel: 'off', label: 'GPT-5.4', rationale: 'Default · multi-turn coding', status: 'shipping' },
  better:   { model: 'gpt-5.4', reasoningLevel: 'low', label: 'GPT-5.4 · reasoning low', rationale: 'Reasoning hint', status: 'shipping' },
  best:     { model: 'gpt-5.4', reasoningLevel: 'medium', label: 'GPT-5.4 · reasoning medium', rationale: 'Deeper reasoning', status: 'shipping' },
  loaded:   { model: 'gpt-5.4', reasoningLevel: 'high', label: 'GPT-5.4 · reasoning high', rationale: 'Loaded · deep multi-step', status: 'shipping' },
};

const LOCAL_TIERS: LlmTierMap = {
  budget:   { model: 'qwen3.6-coder-7b', label: 'Qwen 3.6 Coder 7B', rationale: 'Offline · cheap · install LM Studio / Ollama', status: 'wip' },
  balanced: { model: 'qwen3.6-coder-7b', label: 'Qwen 3.6 Coder 7B', rationale: 'Default local · fast', status: 'wip' },
  better:   { model: 'glm-4.5-air', label: 'GLM 4.5 Air', rationale: 'Higher quality local', status: 'wip' },
  best:     { model: 'qwen3.6-32b', label: 'Qwen 3.6 32B', rationale: 'Best local · needs ≥48GB RAM', status: 'wip' },
  loaded:   { model: 'qwen3.6-32b', reasoningLevel: 'high', label: 'Qwen 3.6 32B · multi-turn', rationale: 'Loaded local · long context · slowest', status: 'wip' },
};

const KIMI_TIERS: LlmTierMap = {
  budget:   { model: 'moonshot-v1-8k',  label: 'Moonshot v1 8K',  rationale: 'Fast · cheap', status: 'shipping' },
  balanced: { model: 'moonshot-v1-32k', label: 'Moonshot v1 32K', rationale: 'Default', status: 'shipping' },
  better:   { model: 'moonshot-v1-128k', label: 'Moonshot v1 128K', rationale: 'Higher quality · long context', status: 'shipping' },
  best:     { model: 'kimi-k2.6', label: 'Kimi K2.6 (1T MoE)', rationale: 'Best · K2.6 flagship', status: 'shipping' },
  loaded:   { model: 'kimi-k2.6', reasoningLevel: 'high', label: 'Kimi K2.6 · reasoning high', rationale: 'Loaded · deep multi-step', status: 'shipping' },
};

const QWEN_TIERS: LlmTierMap = {
  budget:   { model: 'qwen-turbo', label: 'Qwen Turbo', rationale: 'Fast · cheap', status: 'shipping' },
  balanced: { model: 'qwen-plus', label: 'Qwen Plus', rationale: 'Default', status: 'shipping' },
  better:   { model: 'qwen-max', label: 'Qwen Max', rationale: 'Higher quality', status: 'shipping' },
  best:     { model: 'qwen3.6-max-235b', label: 'Qwen 3.6 Max 235B', rationale: 'Best · flagship', status: 'shipping' },
  loaded:   { model: 'qwen3.6-max-235b', reasoningLevel: 'high', label: 'Qwen 3.6 Max 235B · reasoning high', rationale: 'Loaded · deep multi-step', status: 'shipping' },
};

const GLM_TIERS: LlmTierMap = {
  budget:   { model: 'glm-4-flash', label: 'GLM 4 Flash', rationale: 'Fast · cheap', status: 'shipping' },
  balanced: { model: 'glm-4-air', label: 'GLM 4 Air', rationale: 'Default', status: 'shipping' },
  better:   { model: 'glm-4-plus', label: 'GLM 4 Plus', rationale: 'Higher quality', status: 'shipping' },
  best:     { model: 'glm-5.1', label: 'GLM 5.1 (754B MoE)', rationale: 'Best · GLM-5.1 flagship', status: 'shipping' },
  loaded:   { model: 'glm-5.1', reasoningLevel: 'high', label: 'GLM 5.1 · reasoning high', rationale: 'Loaded · deep multi-step', status: 'shipping' },
};

// ⭐ 2026-08-18 재편 — src/model-tier/llm-tier-map.ts 의 GROK 사다리와 «같은 값»이어야 한다.
//    ⛔ 직전 문면(grok-3-mini/grok-3/grok-3-fast/grok-4)은 전부 xAI API 에 «없는» 모델이었다
//      (`/v1/models` 실측 · grok-4 는 200 OK 로 응답하면서 실제로는 grok-4.3 이 돈다).
const GROK_TIERS: LlmTierMap = {
  budget:   { model: 'grok-4.20-non-reasoning', reasoningLevel: 'off', label: 'Grok 4.20 (non-reasoning)', rationale: '$1.25/$2.50 · 2M context', status: 'shipping' },
  balanced: { model: 'grok-4.20', reasoningLevel: 'low', label: 'Grok 4.20 · reasoning low', rationale: '저가 워크호스 · 2M context', status: 'shipping' },
  better:   { model: 'grok-4.6', reasoningLevel: 'medium', label: 'Grok 4.6 · reasoning medium', rationale: 'Flagship 500k · 구현/판정', status: 'shipping' },
  best:     { model: 'grok-4.6', reasoningLevel: 'high', label: 'Grok 4.6 · reasoning high', rationale: 'Flagship 심층 · 골분해/리뷰', status: 'shipping' },
  loaded:   { model: 'grok-4.6', reasoningLevel: 'high', label: 'Grok 4.6 · reasoning high', rationale: '4.6 의 추론 상한이 high 라 best 와 같다', status: 'shipping' },
};

export const LLM_TIER_MAP_BY_PROVIDER: Readonly<Record<LlmTierProvider, LlmTierMap>> = {
  anthropic: ANTHROPIC_TIERS,
  openai: OPENAI_TIERS,
  gemini: GEMINI_TIERS,
  'openai-codex': CODEX_TIERS,
  local: LOCAL_TIERS,
  kimi: KIMI_TIERS,
  qwen: QWEN_TIERS,
  glm: GLM_TIERS,
  grok: GROK_TIERS,
} as const;

export const LLM_TIER_PROVIDER_LABELS: Readonly<Record<LlmTierProvider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  'openai-codex': 'OpenAI Codex',
  local: 'Local',
  kimi: 'Kimi',
  qwen: 'Qwen',
  glm: 'GLM',
  grok: 'Grok',
} as const;

export function isLlmTierProvider(v: unknown): v is LlmTierProvider {
  return typeof v === 'string'
    && Object.prototype.hasOwnProperty.call(LLM_TIER_MAP_BY_PROVIDER, v);
}

/** Resolve (provider, tier) → spec. Returns Anthropic Balanced when
 *  provider is 'auto' or unknown — the slider can still render. */
export function lookupLlmTierSpec(
  provider: LlmTierProvider | 'auto' | string,
  tier: ModelTier,
): LlmTierSpec {
  if (provider === 'auto' || !isLlmTierProvider(provider)) {
    return ANTHROPIC_TIERS.balanced;
  }
  return LLM_TIER_MAP_BY_PROVIDER[provider][tier];
}

// ── TTS tier spec (mirror of src/model-tier/tts-tier-map.ts · M2-2) ──

export type TtsTierProvider = 'openai-tts' | 'elevenlabs-tts' | 'edge-tts' | 'macos-say';

export interface TtsTierSpec {
  provider: TtsTierProvider;
  model: string;
  label: string;
  rationale: string;
  usdPerCharacter: number;
  status: 'shipping' | 'wip';
}

export const TTS_TIER_MAP: Readonly<Record<ModelTier, TtsTierSpec>> = {
  budget: {
    provider: 'macos-say',
    model: 'system',
    label: 'macOS say (local)',
    rationale: 'Free · offline · macOS only',
    usdPerCharacter: 0,
    status: 'shipping',
  },
  balanced: {
    provider: 'openai-tts',
    model: 'tts-1',
    label: 'OpenAI TTS',
    rationale: 'Default · $15/M chars · multi-voice',
    usdPerCharacter: 0.0000150,
    status: 'shipping',
  },
  better: {
    provider: 'openai-tts',
    model: 'tts-1-hd',
    label: 'OpenAI TTS HD',
    rationale: 'Higher fidelity · $30/M chars',
    usdPerCharacter: 0.0000300,
    status: 'shipping',
  },
  best: {
    provider: 'elevenlabs-tts',
    model: 'eleven_flash_v2_5',
    label: 'ElevenLabs Flash v2.5',
    rationale: 'Best · ~75ms latency · 32 langs · $20/M chars',
    usdPerCharacter: 0.0000200,
    status: 'shipping',
  },
  loaded: {
    provider: 'elevenlabs-tts',
    model: 'eleven_multilingual_v2',
    label: 'ElevenLabs Multilingual v2',
    rationale: 'Loaded · long-form fidelity · 29 langs · ~$20/M chars',
    usdPerCharacter: 0.0000200,
    status: 'shipping',
  },
};

/** Project monthly USD given a daily char volume estimate. */
export function projectTtsMonthlyCost(
  tier: ModelTier,
  charsPerDay: number,
): number {
  if (!Number.isFinite(charsPerDay) || charsPerDay <= 0) return 0;
  return charsPerDay * 30 * TTS_TIER_MAP[tier].usdPerCharacter;
}
