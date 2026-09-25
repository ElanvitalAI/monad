// ── Google Gemini model catalog — Wave 3 (2026-05-04) ──
//
// Mirrors src/codex/models.ts + src/anthropic/models.ts pattern.
// Curated subset of the Gemini roster monad-agent tracks for the
// wizard / picker. Source-of-truth: ai.google.dev/gemini-api/docs/models +
// cloud.google.com/vertex-ai/generative-ai/pricing (cross-referenced
// 2026-05-04).
//
// Wave 1 (2026-05-04) unblocked native @google/genai SDK so the
// thinkingConfig / safetySettings / systemInstruction surface is
// reachable. This catalog records which models support that surface
// (gemini-2.5+) for the modelSupportsReasoning gate.

export type GeminiModelTier = 'flagship' | 'balanced' | 'cheap' | 'legacy';

export interface GeminiModel {
  id: string;
  /** Human-friendly label for the picker. */
  label: string;
  tier: GeminiModelTier;
  /** One-line elevator pitch. */
  description: string;
  /** Context window (tokens). null when not publicly specified. */
  contextWindow: number | null;
  /** Approximate pricing in USD per M input / M output tokens.
   *  Informational only; actual billing comes from Google. */
  pricingUsd: { inputPerM: number; outputPerM: number; cacheReadPerM?: number; longContext?: { thresholdTokens: number; inputPerM: number; outputPerM: number; cacheReadPerM?: number } } | null;
  /** True when this model supports thinkingConfig (gemini-2.5+).
   *  Wired into modelSupportsReasoning('gemini', model). */
  supportsThinking: boolean;
  /** Shown as the default pick in the wizard when true. Exactly one
   *  model should be marked recommended at any time. */
  recommended?: boolean;
}

/** Curated Gemini models for the 1-point setup picker. Ordering
 *  reflects the UI: recommended first, then by descending tier.
 *  Refreshed 2026-05-04 — gemini-3.1-pro is the current flagship. */
export const GEMINI_MODELS: GeminiModel[] = [
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview)',
    tier: 'flagship',
    description: 'Latest flagship — top reasoning + native tools + extended thinking. Recommended for monad-agent gemini sessions. Note: id carries -preview suffix; full id required by v1beta endpoint.',
    // ⛔ 2026-08-18 정정: 2_000_000 은 «낡은 값»이었다 — Gemini `/v1beta/models` 실측
    //    inputTokenLimit=1048576(1M). 2.5 계열부터 1M 로 표준화됐다(1.5 Pro 만 2M 였다).
    contextWindow: 1_048_576,
    // 📏 2026-09-25 정정: 공식 $2/$12(≤200K · 초과분 $4/$18) — $1.25/$10 은 옛 2.5-pro 값이었다.
    // 📏 C8(2026-09-25 · omni-crawl · ai.google.dev pricing): 프롬프트 200K 초과면 «요청 전체»가 $4/$18.
    pricingUsd: { inputPerM: 2.00, outputPerM: 12.00, cacheReadPerM: 0.20, longContext: { thresholdTokens: 200_000, inputPerM: 4.00, outputPerM: 18.00 } },
    supportsThinking: true,
  },
  {
    id: 'gemini-3-pro-preview',
    label: 'Gemini 3.0 Pro (preview)',
    tier: 'flagship',
    description: 'Prior 3-family flagship. Stable fallback when 3.1 has unexpected behavior.',
    // ⛔ 2026-08-18 정정: 2_000_000 은 «낡은 값»이었다 — Gemini `/v1beta/models` 실측
    //    inputTokenLimit=1048576(1M). 2.5 계열부터 1M 로 표준화됐다(1.5 Pro 만 2M 였다).
    contextWindow: 1_048_576,
    pricingUsd: { inputPerM: 1.25, outputPerM: 10.00 },
    supportsThinking: true,
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    tier: 'flagship',
    description: 'Prior flagship — 2M context, extended thinking. Stable fallback when 3.1 has unexpected behavior.',
    // ⛔ 2026-08-18 정정: 2_000_000 은 «낡은 값»이었다 — Gemini `/v1beta/models` 실측
    //    inputTokenLimit=1048576(1M). 2.5 계열부터 1M 로 표준화됐다(1.5 Pro 만 2M 였다).
    contextWindow: 1_048_576,
    pricingUsd: { inputPerM: 1.25, outputPerM: 10.00 },
    supportsThinking: true,
  },
  {
    // ⭐ 2026-08-18 신규 — flash 최신은 «3.7» 이다(대표 지적). Gemini `/v1beta/models`
    //    실측: gemini-3.5-flash · 3.6-flash · 3.7-flash 가 모두 실재하고
    //    셋 다 inputTokenLimit=1048576 · outputTokenLimit=65536.
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    tier: 'balanced',
    description: '직전 flash — 1M context, 저지연 워크호스.',
    contextWindow: 1_048_576,
    // 📏 2026-09-25 정정: $0.30/$2.50 은 flash-lite(2.5-flash) 값이었다. 공식 도입가 $0.75/$3.75(2027-01-01부터 $1.5/$7.5) · 캐시 ~10%.
    pricingUsd: { inputPerM: 0.75, outputPerM: 3.75, cacheReadPerM: 0.075 },
    supportsThinking: true,
  },
  {
    // ⭐ 2026-09-25 (대표 「모델별 최신으로」) — flash 최신은 «3.8»(09-02) · `models.list` 실측 ⊕ 실호출 OK.
    //    📏 공식 도입가 $0.75/$3.75 (2026-12-31 까지 · 2027-01-01부터 $1.5/$7.5) · 캐시 ~10%.
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    tier: 'balanced',
    description: '최신 flash — 1M context, 저지연 워크호스. 일상 코딩/판정 기본.',
    contextWindow: 1_048_576,
    pricingUsd: { inputPerM: 0.75, outputPerM: 3.75, cacheReadPerM: 0.075 },
    supportsThinking: true,
    recommended: true,
  },
  {
    // ⭐ 2026-09-25 — flash-lite 최신은 «3.5»(07-21) · 공식 $0.30/$2.50 · 캐시 ~10%.
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    tier: 'cheap',
    description: '최신 flash-lite — 대량·분류·저비용.',
    contextWindow: 1_048_576,
    pricingUsd: { inputPerM: 0.30, outputPerM: 2.50, cacheReadPerM: 0.03 },
    supportsThinking: true,
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    tier: 'balanced',
    description: 'Sweet-spot — 1M context, fast, cheap. Pick for everyday coding without flagship cost.',
    contextWindow: 1_000_000,
    // 📏 2026-09-25 정정(C9): $0.075/$0.30 은 다른 모델 값이었다 — 공식 $0.30/$2.50(정본 BUILTIN_CATALOG 와 같다).
    pricingUsd: { inputPerM: 0.30, outputPerM: 2.50 },
    supportsThinking: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    tier: 'cheap',
    description: 'Cheapest 2.5 tier. 1M context, basic thinking. Use for high-volume / classification flows.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 0.04, outputPerM: 0.15 },
    supportsThinking: true,
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash (legacy)',
    tier: 'legacy',
    description: 'Prior generation — no thinkingConfig surface. Stable fallback when 2.5+ has unexpected behavior.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 0.10, outputPerM: 0.40 },
    supportsThinking: false,
  },
];

export function defaultGeminiModel(): GeminiModel {
  return GEMINI_MODELS.find(m => m.recommended) ?? GEMINI_MODELS[0]!;
}

export function findGeminiModel(id: string): GeminiModel | undefined {
  return GEMINI_MODELS.find(m => m.id === id);
}
