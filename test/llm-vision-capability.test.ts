// Image-pipeline P3 — vision-capability allowlist tests.
//
// Verifies the (brand, model, axis) → boolean lookups that gate the
// wire layer's image-bearing tool_result decisions. Coverage:
//   - Anthropic: every Claude 3.5+ model supports both axes.
//   - openai-codex: gpt-5 family supports tool-result image bytes via
//     Codex Responses ContentItem[].
//   - openai (Chat): user-message vision yes; tool-message vision NO
//     (spec gap — explicit text-fallback contract).
//   - grok: same OpenAI-compat constraint; grok-*-vision OK on user.
//   - gemini: pro/flash user-message vision yes; tool-result NO
//     (functionResponse.response is text-only Struct).
//   - local / unknown: always false (safe default).

import { describe, expect, test } from 'bun:test';

import {
  acceptsToolResultImage,
  isVisionCapableModel,
  type LlmBrand,
} from '../src/llm-vision-capability.js';

describe('isVisionCapableModel — Anthropic', () => {
  test.each<[string, boolean]>([
    ['claude-3-5-sonnet-20241022', true],
    ['claude-opus-4-7', true],
    ['claude-sonnet-4-6', true],
    ['claude-haiku-4-5-20251001', true],
    ['opus', true],
    ['sonnet', true],
    ['haiku', true],
    ['sonnet-4-5', true],
    ['opus-4-7', true],
    // Empty / unknown.
    ['', false],
    ['gpt-4o', false],
  ])('claude(%s) → %s on toolResult', (model, expected) => {
    expect(isVisionCapableModel('anthropic', model, 'toolResult')).toBe(expected);
    // Both axes match for Anthropic — image_url in tool_result and user
    // messages alike are supported on Claude 3.5+.
    expect(isVisionCapableModel('anthropic', model, 'userMessage')).toBe(expected);
  });
});

describe('isVisionCapableModel — Codex Responses (openai-codex)', () => {
  test.each<[string, boolean]>([
    ['gpt-5', true],
    ['gpt-5-codex', true],
    ['gpt-5-mini', true],
    ['gpt-5-codex-2026-04', true],
    // 2026-05 verification: GPT-5.4 (March 2026) + GPT-5.5 (April 2026)
    // route through Responses API with multimodal function_call_output.
    ['gpt-5.4', true],
    ['gpt-5.4-mini', true],
    ['gpt-5.5', true],
    ['codex-stable', true],
    // Non-codex / pre-5 → false.
    ['gpt-4o', false],
    ['gpt-4-turbo', false],
    ['', false],
  ])('openai-codex(%s) → %s on toolResult', (model, expected) => {
    expect(isVisionCapableModel('openai-codex', model, 'toolResult')).toBe(expected);
  });
});

describe('isVisionCapableModel — OpenAI Chat', () => {
  test('user-message vision: gpt-4o family yes, gpt-3.5 no', () => {
    expect(isVisionCapableModel('openai', 'gpt-4o', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('openai', 'gpt-4o-mini', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('openai', 'gpt-4-turbo', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('openai', 'gpt-4-vision-preview', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('openai', 'gpt-3.5-turbo', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('openai', '', 'userMessage')).toBe(false);
  });

  test('tool-result axis is always false for OpenAI Chat (spec gap)', () => {
    // Even gpt-4o which has user-message vision DOES NOT have
    // tool-result vision per the public spec — we keep this strict
    // until OpenAI documents the shape.
    expect(isVisionCapableModel('openai', 'gpt-4o', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('openai', 'gpt-4o-mini', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('openai', 'gpt-4-turbo', 'toolResult')).toBe(false);
  });
});

describe('isVisionCapableModel — Grok (xAI)', () => {
  test('user-message vision: grok-*-vision · grok-2/3/4 base yes', () => {
    expect(isVisionCapableModel('grok', 'grok-2-vision', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('grok', 'grok-vision-beta', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('grok', 'grok-2', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('grok', 'grok-3', 'userMessage')).toBe(true);
    // 2026-05 verification: grok-4.2 / 4.3 multimodal via image_url
    // on user messages (xAI docs).
    expect(isVisionCapableModel('grok', 'grok-4.2', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('grok', 'grok-4.3', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('grok', 'grok-1', 'userMessage')).toBe(false);
  });

  test('tool-result axis stays false — elanous routes Grok via Chat Completions (text-only tool messages)', () => {
    expect(isVisionCapableModel('grok', 'grok-2-vision', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('grok', 'grok-3', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('grok', 'grok-4.3', 'toolResult')).toBe(false);
  });
});

describe('isVisionCapableModel — Gemini', () => {
  test('user-message vision: pro / flash / gemini-3.x yes', () => {
    expect(isVisionCapableModel('gemini', 'gemini-pro', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', 'gemini-2.5-pro', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', 'gemini-3.1-pro', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', 'gemini-3.1-flash', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', 'pro', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', 'flash', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('gemini', '', 'userMessage')).toBe(false);
  });

  test('tool-result axis: Gemini 3+ true (multimodal functionResponse.parts), pre-3 false', () => {
    // P3.5 (2026-05) — Gemini 3 series adds functionResponse.parts
    // with FunctionResponsePart inline_data.
    expect(isVisionCapableModel('gemini', 'gemini-3.1-pro', 'toolResult')).toBe(true);
    expect(isVisionCapableModel('gemini', 'gemini-3.1-flash', 'toolResult')).toBe(true);
    expect(isVisionCapableModel('gemini', 'gemini-3.1-flash-lite-preview', 'toolResult')).toBe(true);
    // Pre-3 still text-only (response: Struct).
    expect(isVisionCapableModel('gemini', 'gemini-2.5-pro', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('gemini', 'gemini-1.5-pro', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('gemini', 'flash', 'toolResult')).toBe(false);
    // Future-proof generations (4.x+).
    expect(isVisionCapableModel('gemini', 'gemini-4-pro', 'toolResult')).toBe(true);
  });
});

describe('isVisionCapableModel — Local', () => {
  test('Qwen VL family — userMessage true (2026-05 omni-crawl verified)', () => {
    // Explicit -VL suffix forms.
    expect(isVisionCapableModel('local', 'qwen3-vl', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3-vl-2b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3-vl-32b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3-vl-235b-a22b-instruct', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen2.5-vl', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen2.5-vl-7b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen-vl-plus', 'userMessage')).toBe(true);
    // Qwen 3.5+ multimodal native (any size).
    expect(isVisionCapableModel('local', 'qwen3.5-9b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3.5-27b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3.5-35b-a3b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'qwen3.6-27b', 'userMessage')).toBe(true);
  });

  test('Gemma 4 family — userMessage true (all sizes have native vision)', () => {
    expect(isVisionCapableModel('local', 'gemma-4-e2b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'gemma-4-e4b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'gemma-4-26b-a4b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'gemma-4-31b', 'userMessage')).toBe(true);
    // LM Studio surfaces with `google/` prefix.
    expect(isVisionCapableModel('local', 'google/gemma-4-31b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'google/gemma-4-e4b', 'userMessage')).toBe(true);
  });

  test('LLaVA family — userMessage true (legacy multimodal)', () => {
    expect(isVisionCapableModel('local', 'llava-1.6', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'llava-1.6-mistral-7b', 'userMessage')).toBe(true);
    expect(isVisionCapableModel('local', 'llava-next', 'userMessage')).toBe(true);
  });

  test('text-only local models stay false', () => {
    // Pre-3.5 Qwen base / coder variants are text-only.
    expect(isVisionCapableModel('local', 'qwen2.5-coder-7b', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('local', 'qwen3-base', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('local', 'qwen3-coder', 'userMessage')).toBe(false);
    // Pre-Gemma-4 generations.
    expect(isVisionCapableModel('local', 'gemma-2-9b', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('local', 'gemma-3-27b', 'userMessage')).toBe(false);
    // Other text-only local families.
    expect(isVisionCapableModel('local', 'llama3.2-3b', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('local', 'phi3.5-mini', 'userMessage')).toBe(false);
    expect(isVisionCapableModel('local', 'mistral-7b', 'userMessage')).toBe(false);
  });

  test('toolResult axis stays false for local — workaround flows via userMessage', () => {
    // Local providers route through OpenAI Chat Completions; tool
    // message content is text-only by spec. The follow-up workaround
    // in toOpenAIMessages activates on the userMessage axis instead,
    // so vision-capable local models still receive tool-result images
    // via the synthetic user message — but the toolResult axis lookup
    // itself stays false to keep the wire decision explicit.
    expect(isVisionCapableModel('local', 'qwen3-vl-7b', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('local', 'gemma-4-31b', 'toolResult')).toBe(false);
    expect(isVisionCapableModel('local', 'llava-1.6', 'toolResult')).toBe(false);
  });
});

describe('isVisionCapableModel — defensive defaults', () => {
  test('undefined/empty model → false on every axis/brand', () => {
    const brands: LlmBrand[] = ['anthropic', 'openai', 'openai-codex', 'grok', 'gemini', 'local'];
    for (const brand of brands) {
      expect(isVisionCapableModel(brand, undefined, 'toolResult')).toBe(false);
      expect(isVisionCapableModel(brand, undefined, 'userMessage')).toBe(false);
      expect(isVisionCapableModel(brand, '', 'toolResult')).toBe(false);
      expect(isVisionCapableModel(brand, '', 'userMessage')).toBe(false);
    }
  });
});

describe('acceptsToolResultImage convenience wrapper', () => {
  test('matches isVisionCapableModel(..., "toolResult")', () => {
    // Sanity sample — same lookup, shorter call site.
    expect(acceptsToolResultImage('anthropic', 'sonnet-4-6')).toBe(true);
    expect(acceptsToolResultImage('openai-codex', 'gpt-5-codex')).toBe(true);
    expect(acceptsToolResultImage('openai-codex', 'gpt-5.5')).toBe(true);
    expect(acceptsToolResultImage('openai', 'gpt-4o')).toBe(false);
    expect(acceptsToolResultImage('gemini', 'gemini-2.5-pro')).toBe(false);
    // P3.5: Gemini 3+ now true on toolResult.
    expect(acceptsToolResultImage('gemini', 'gemini-3.1-pro')).toBe(true);
    expect(acceptsToolResultImage('gemini', 'gemini-3.1-flash')).toBe(true);
  });
});
