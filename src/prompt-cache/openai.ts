// OpenAI usage parser.
//
// OpenAI performs prompt caching automatically — no cache_control
// field on the request side. The response surface carries cache hit
// telemetry in the final stream chunk's `usage` object when the
// request enabled `stream_options.include_usage: true`:
//
//   {
//     "choices": [{ "delta": {}, "finish_reason": "stop" }],
//     "usage": {
//       "prompt_tokens": 140,
//       "completion_tokens": 320,
//       "prompt_tokens_details": { "cached_tokens": 1024 }
//     }
//   }
//
// We normalize into the cross-provider LLMUsage shape so session
// metrics and the dashboard log line stay provider-agnostic.
//
// Grok is OpenAI-compatible on the shape side but has not shipped
// prompt caching as of 2026-04 — usage payloads just omit
// `prompt_tokens_details`. Same parser still runs, emits a usage
// event with cacheReadInputTokens absent (treated as 0 downstream).

import type { LLMUsage } from './types.js';

/** Extract LLMUsage from an OpenAI streaming chunk. Returns null when
 *  the chunk has no usage object (every chunk except the final one
 *  when include_usage:true is set). */
export function parseOpenAIUsage(event: unknown): LLMUsage | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as { usage?: unknown };
  const raw = e.usage;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** Kimi(Moonshot) — 최상위에 싣는다. */
    cached_tokens?: number;
    /** DeepSeek — `prompt_tokens` = hit + miss. */
    prompt_cache_hit_tokens?: number;
    /** OpenRouter 실제 청구액(USD) — `usage:{include:true}` 일 때 마지막 청크에. */
    cost?: number;
  };
  const out: LLMUsage = { provider: 'openai' };
  // ⛔⭐ elanous 의 `inputTokens` 는 «새 입력만»이다(Anthropic 규약 · metrics 적중률 분모 = input + cacheRead + cacheCreation).
  //   OpenAI 계열 `prompt_tokens` 는 캐시 적중분을 «포함»하므로 뺀다. 빼지 않으면 캐시분이 입력 단가로 한 번,
  //   캐시 단가로 또 한 번 매겨진다(BACKLOG C4 · opencode openai-chat.ts · hermes normalize_usage 와 같은 처리).
  const cached = [r.prompt_tokens_details?.cached_tokens, r.cached_tokens, r.prompt_cache_hit_tokens]
    .find((v): v is number => typeof v === 'number');
  if (typeof r.prompt_tokens === 'number') out.inputTokens = Math.max(0, r.prompt_tokens - (cached ?? 0));
  if (typeof r.completion_tokens === 'number') out.outputTokens = r.completion_tokens;
  if (cached !== undefined) {
    out.cacheReadInputTokens = cached;
    // OpenAI caches are free-on-hit and rolled into prompt_tokens for
    // creation — we set creation to 0 so metrics math (hit-rate) works
    // uniformly across providers.
    out.cacheCreationInputTokens = 0;
  }
  // Reasoning tokens — OpenAI o1/o3, qwen 3.6 (LM Studio surfaces this
  // even though qwen calls it `reasoning_content` rather than the
  // OpenAI Responses-API `summary` shape), gpt-oss. Counted inside
  // `completion_tokens` already, broken out for cost attribution.
  if (typeof r.completion_tokens_details?.reasoning_tokens === 'number') {
    out.reasoningOutputTokens = r.completion_tokens_details.reasoning_tokens;
  }
  if (typeof r.cost === 'number' && Number.isFinite(r.cost) && r.cost >= 0) out.reportedCostUsd = r.cost;
  const keys = Object.keys(out).filter(k => k !== 'provider');
  return keys.length === 0 ? null : out;
}
