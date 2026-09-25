import { describe, expect, test } from 'bun:test';
import { parseOpenAISSELines, type LLMStreamEvent } from '../../src/llm.js';

async function collect(
  gen: AsyncGenerator<LLMStreamEvent, void, unknown>,
): Promise<LLMStreamEvent[]> {
  const out: LLMStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// Grok reuses the OpenAI SSE shape. We already verified
// parseOpenAISSELines handles OpenAI's prompt_tokens_details shape
// in openai-usage.test.ts. Here we assert the Grok-specific case:
// usage present but WITHOUT prompt_tokens_details (Grok doesn't
// report cache_tokens yet) — we should still yield a usage event
// with input/output counters, just no cacheReadInputTokens field.

describe('parseOpenAISSELines — Grok-style usage (no cached_tokens)', () => {
  test('usage without prompt_tokens_details emits usage event with just input/output', async () => {
    const lines = [
      `data: {"choices":[{"delta":{"content":"hello"}}]}`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":200,"completion_tokens":50,"total_tokens":250}}`,
      `data: [DONE]`,
    ];
    const events = await collect(parseOpenAISSELines(lines));
    const usages = events.filter(e => e.type === 'usage');
    expect(usages).toHaveLength(1);
    expect(usages[0]).toEqual({
      type: 'usage',
      usage: {
        provider: 'openai',
        inputTokens: 200,
        outputTokens: 50,
      },
    });
  });

  test('Grok-shaped stream without any usage → no usage events', async () => {
    const lines = [
      `data: {"choices":[{"delta":{"content":"hello"}}]}`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
      `data: [DONE]`,
    ];
    const events = await collect(parseOpenAISSELines(lines));
    expect(events.filter(e => e.type === 'usage')).toEqual([]);
  });
});
