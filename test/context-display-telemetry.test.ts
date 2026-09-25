// ── Wave 1 · telemetry ring buffer ──

import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearTelemetryForTest,
  getLatestCall,
  getRecentCalls,
  getSessionStats,
  recordLlmCall,
  recordLlmUsage,
  telemetryBufferStats,
} from '../src/context-display/telemetry';

afterEach(() => {
  clearTelemetryForTest();
});

describe('Wave 1 · context-display telemetry', () => {
  test('recordLlmCall pushes and getLatestCall returns last entry', () => {
    recordLlmCall({
      ts: 1, provider: 'anthropic', model: 'claude-opus-4-7',
      inputTokens: 1000, outputTokens: 200,
      cacheReadInputTokens: 500, cacheCreationInputTokens: 0,
    });
    recordLlmCall({
      ts: 2, provider: 'openai', model: 'gpt-4o',
      inputTokens: 500, outputTokens: 100,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });
    const latest = getLatestCall();
    expect(latest?.model).toBe('gpt-4o');
    expect(latest?.totalTokens).toBe(600);
  });

  test('recordLlmUsage maps LLMUsage shape into telemetry record', () => {
    const entry = recordLlmUsage({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage: {
        provider: 'anthropic',
        inputTokens: 800,
        outputTokens: 150,
        cacheReadInputTokens: 600,
        cacheCreationInputTokens: 50,
      },
    });
    expect(entry.totalTokens).toBe(950);
    expect(entry.cacheReadInputTokens).toBe(600);
    expect(getRecentCalls()).toHaveLength(1);
  });

  test('reasoningOutputTokens contributes to totalTokens but stays 0-omitted', () => {
    const entry = recordLlmUsage({
      provider: 'openai',
      model: 'gpt-4o',
      usage: { inputTokens: 100, outputTokens: 50 },
      reasoningOutputTokens: 30,
    });
    expect(entry.totalTokens).toBe(180);
    expect(entry.reasoningOutputTokens).toBe(30);
    const noReasoning = recordLlmUsage({
      provider: 'openai',
      model: 'gpt-4o',
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(noReasoning.reasoningOutputTokens).toBeUndefined();
  });

  test('ring buffer caps at 200 entries', () => {
    for (let i = 0; i < 250; i++) {
      recordLlmCall({
        ts: i, provider: 'anthropic', model: 'claude-haiku-4-5',
        inputTokens: 1, outputTokens: 1,
        cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      });
    }
    const stats = telemetryBufferStats();
    expect(stats.size).toBe(200);
    expect(stats.max).toBe(200);
    // Oldest dropped — first surviving entry should have ts=50
    expect(getRecentCalls()[0]?.ts).toBe(50);
  });

  test('getSessionStats aggregates per provider / model / role', () => {
    recordLlmCall({
      ts: 1, provider: 'anthropic', model: 'claude-opus-4-7', role: 'main',
      inputTokens: 1000, outputTokens: 200,
      cacheReadInputTokens: 800, cacheCreationInputTokens: 0,
    });
    recordLlmCall({
      ts: 2, provider: 'anthropic', model: 'claude-haiku-4-5', role: 'summarizer',
      inputTokens: 5000, outputTokens: 800,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });
    recordLlmCall({
      ts: 3, provider: 'openai', model: 'gpt-4o', role: 'main',
      inputTokens: 300, outputTokens: 50,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });

    const stats = getSessionStats();
    expect(stats.callCount).toBe(3);
    expect(stats.totalInput).toBe(6300);
    expect(stats.totalCacheRead).toBe(800);
    expect(stats.perProvider['anthropic']?.callCount).toBe(2);
    expect(stats.perProvider['openai']?.callCount).toBe(1);
    expect(stats.perRole['summarizer']?.totalInput).toBe(5000);
    expect(stats.perRole['main']?.callCount).toBe(2);
    expect(stats.perModel['claude-opus-4-7']?.totalOutput).toBe(200);
  });

  test('getRecentCalls(limit) returns last N entries', () => {
    for (let i = 1; i <= 10; i++) {
      recordLlmCall({
        ts: i, provider: 'anthropic', model: 'claude-haiku-4-5',
        inputTokens: i * 10, outputTokens: 5,
        cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
      });
    }
    const last3 = getRecentCalls(3);
    expect(last3).toHaveLength(3);
    expect(last3.map(c => c.ts)).toEqual([8, 9, 10]);
  });

  test('clearTelemetryForTest empties buffer + getLatestCall returns null', () => {
    recordLlmCall({
      ts: 1, provider: 'anthropic', model: 'claude-opus-4-7',
      inputTokens: 1, outputTokens: 1,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });
    expect(getLatestCall()).not.toBeNull();
    clearTelemetryForTest();
    expect(getLatestCall()).toBeNull();
    expect(getSessionStats().callCount).toBe(0);
  });
});
