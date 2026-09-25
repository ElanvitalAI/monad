import { describe, expect, it, spyOn } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { streamLLMWithTools, type LLMProvider, type LLMStreamEvent } from '../src/llm.js';

// 주 에이전트 턴(streamLLMWithTools)의 사용량이 `debug.enabled` 와 무관하게 `llm.usage` 로 남는가.
// 2026-09-24 실측: 이 줄이 없어 3시간 `llm.usage` 18행이 전부 곁가지 두 자리였다.

function provider(model: string, events: LLMStreamEvent[]): LLMProvider {
  return {
    name: 'probe-provider',
    defaultModel: model,
    available: () => true,
    async *streamChat() {
      yield* events;
    },
    async *chat() {
      for (const event of events) if (event.type === 'text') yield event.delta;
    },
  };
}

async function usageRows(model: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  // 전제: 시험 환경은 debug 가 꺼져 있다 — 그래야 「게이트 없이 남긴다」를 잰다(기존 `chat.cache.turn` 은 이 게이트에 막힌다).
  expect(debug.enabled).toBe(false);
  const logSpy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
    if (category === 'llm.usage' && event === 'llm-usage') rows.push((data ?? {}) as Record<string, unknown>);
  });
  try {
    await streamLLMWithTools(
      [{ role: 'user', content: 'measure this turn' }],
      { onText: () => {}, dispatchTool: async () => ({}) },
      {
        provider: provider(model, [
          { type: 'usage', usage: { inputTokens: 1200, outputTokens: 300 } },
          { type: 'text', delta: 'done' },
        ]),
        model,
        tools: [{ name: 'probe', description: 'keeps the tool loop active', parameters: {} }],
        maxTurns: 1,
      },
    );
  } finally {
    logSpy.mockRestore();
  }
  return rows;
}

describe('agent-turn usage observation', () => {
  it('records one llm.usage row per usage event with the turn model and a cost, even with debug disabled', async () => {
    const rows = await usageRows('gpt-6-sol');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ site: 'agent-turn', model: 'gpt-6-sol', inputTokens: 1200, outputTokens: 300 });
    expect(rows[0]!.cost).toMatchObject({ kind: 'known' });
    expect(rows[0]).not.toHaveProperty('cacheReadInputTokens');
  });

  it('marks an unpriced model as unknown instead of folding it to zero dollars', async () => {
    const rows = await usageRows('no-such-model-for-pricing');
    expect(rows).toHaveLength(1);
    expect((rows[0]!.cost as { kind: string }).kind).toBe('unknown');
    expect(rows[0]!.cost).not.toHaveProperty('usd');
  });
});
