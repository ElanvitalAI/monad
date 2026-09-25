// ── Anthropic (Claude) model catalog — Wave 3 (2026-05-04) ──
//
// Mirrors src/codex/models.ts pattern. Curated subset of the
// Anthropic roster monad-agent tracks for the wizard / picker.
// Source-of-truth: anthropic.com/pricing + docs.anthropic.com/en/docs/about-claude/models
// (cross-referenced 2026-05-04).
//
// Refresh cadence: re-run omni-crawl when Anthropic ships a new
// flagship / mini / haiku release.

export type ClaudeModelTier = 'flagship' | 'balanced' | 'cheap' | 'legacy';

export interface ClaudeModel {
  id: string;
  /** Human-friendly label for the picker. */
  label: string;
  tier: ClaudeModelTier;
  /** One-line elevator pitch. */
  description: string;
  /** Context window (tokens). null when not publicly specified. */
  contextWindow: number | null;
  /** Approximate pricing in USD per M input / M output tokens.
   *  Cache read / write rates included when supported.
   *  Informational only; actual billing comes from Anthropic. */
  pricingUsd: {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
  } | null;
  /** True when this model supports extended thinking
   *  (claude-3.7+ / claude-4 family). Wired into
   *  modelSupportsReasoning('anthropic', model). */
  supportsThinking: boolean;
  /** Shown as the default pick in the wizard when true. Exactly one
   *  model should be marked recommended at any time. */
  recommended?: boolean;
}

/** Curated Claude models for the 1-point setup picker. Ordering
 *  reflects the UI: recommended first, then by descending tier. */
export const CLAUDE_MODELS: ClaudeModel[] = [
  {
    // ⭐ 2026-09-25 (대표 「모델별 최신으로」) — Anthropic `/v1/models` 실측 `claude-opus-5-5`(09-21) ⊕ 실호출 OK.
    //    📏 공식(platform.claude.com opus-5-5): $4/$20 · 1M ctx · 출력 128K · 캐시 읽기 $0.20(입력의 5% — 통상 10% 가 아니다).
    //    ⛔ 캐시 쓰기 단가는 공식 문서에서 못 찾았다 → 비워 둔다(입력 단가로 매기고 `cacheWritePricedAt: input-rate` 로 드러난다).
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    tier: 'flagship',
    description: 'Latest Opus — top reasoning + agentic coding, 1M context, adaptive thinking. Cheaper than Opus 5.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 4.00, outputPerM: 20.00, cacheReadPerM: 0.20 },
    supportsThinking: true,
    recommended: true,
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    tier: 'flagship',
    description: 'Top reasoning + tool use, 1M context, extended thinking. Recommended for monad-agent sessions where quality matters.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 5.00, outputPerM: 25.00, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tier: 'balanced',
    description: 'Balanced reasoning + cost. 1M context, extended thinking. Pick for everyday coding without flagship cost.',
    contextWindow: 1_000_000,
    pricingUsd: { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
    supportsThinking: true,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    tier: 'cheap',
    description: 'Fast + cheap. 200K context, extended thinking. Use for high-throughput / latency-sensitive flows.',
    contextWindow: 200_000,
    pricingUsd: { inputPerM: 1.00, outputPerM: 5.00, cacheReadPerM: 0.10, cacheWritePerM: 1.25 },
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4',
    label: 'Claude Opus 4 (legacy)',
    tier: 'legacy',
    description: 'Prior flagship. Stable fallback when 4.7 has unexpected behavior. Higher per-token cost.',
    contextWindow: 200_000,
    pricingUsd: { inputPerM: 15.00, outputPerM: 75.00 },
    supportsThinking: false,
  },
];

export function defaultClaudeModel(): ClaudeModel {
  return CLAUDE_MODELS.find(m => m.recommended) ?? CLAUDE_MODELS[0]!;
}

export function findClaudeModel(id: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find(m => m.id === id);
}
