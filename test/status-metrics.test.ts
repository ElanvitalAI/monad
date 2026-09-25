// ── Status-metrics session tracker tests ──

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  getSessionMetrics, resetSessionMetrics, recordTurn, sessionElapsedSec,
} from '../src/status/metrics';

beforeEach(() => resetSessionMetrics());

describe('fresh session', () => {
  test('all counters start at zero', () => {
    const m = getSessionMetrics();
    expect(m.totalInputTokens).toBe(0);
    expect(m.totalOutputTokens).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(m.turnCount).toBe(0);
    expect(m.lastTokensPerSec).toBeNull();
  });

  test('sessionElapsedSec grows', async () => {
    const before = sessionElapsedSec();
    await new Promise(r => setTimeout(r, 20));
    expect(sessionElapsedSec()).toBeGreaterThanOrEqual(before);
  });
});

describe('recordTurn', () => {
  test('accumulates tokens + cost from estimates', () => {
    recordTurn({
      model: 'gpt-5.4-mini',
      estimatedPromptText: 'a'.repeat(400),   // ~100 tokens
      estimatedOutputText: 'b'.repeat(800),   // ~200 tokens
      seconds: 2,
    });
    const m = getSessionMetrics();
    expect(m.totalInputTokens).toBeGreaterThan(50);
    expect(m.totalOutputTokens).toBeGreaterThan(150);
    expect(m.totalCostUsd).toBeGreaterThan(0);
    expect(m.turnCount).toBe(1);
    expect(m.lastModel).toBe('gpt-5.4-mini');
    expect(m.lastTokensPerSec).toBeGreaterThan(0);
  });

  test('uses provider-reported usage when available', () => {
    recordTurn({
      model: 'gpt-5.4-mini',
      usage: { inputTokens: 1000, outputTokens: 500 },
      seconds: 1,
    });
    const m = getSessionMetrics();
    expect(m.totalInputTokens).toBe(1000);
    expect(m.totalOutputTokens).toBe(500);
    // 1000/1M * 0.75 + 500/1M * 3.0 = 0.00075 + 0.0015 = 0.00225
    expect(m.totalCostUsd).toBeCloseTo(0.00225, 4);
  });

  test('multiple turns accumulate', () => {
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 100, outputTokens: 50 }, seconds: 1 });
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 200, outputTokens: 100 }, seconds: 1 });
    const m = getSessionMetrics();
    expect(m.totalInputTokens).toBe(300);
    expect(m.totalOutputTokens).toBe(150);
    expect(m.turnCount).toBe(2);
  });

  test('context window tracks the most recent turn only', () => {
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 500, outputTokens: 100 }, seconds: 1 });
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 2000, outputTokens: 300 }, seconds: 1 });
    const m = getSessionMetrics();
    expect(m.lastContextUsed).toBe(2300);
    expect(m.lastContextMax).toBe(400_000);
  });

  test('explicit contextMax still overrides model-derived max', () => {
    recordTurn({
      model: 'gpt-5.4',
      usage: { inputTokens: 100, outputTokens: 50 },
      seconds: 1,
      contextMax: 12_345,
    });
    expect(getSessionMetrics().lastContextMax).toBe(12_345);
  });

  test('zero seconds → null tokensPerSec', () => {
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 100, outputTokens: 100 }, seconds: 0 });
    expect(getSessionMetrics().lastTokensPerSec).toBeNull();
  });

  test('cost uses correct per-model pricing', () => {
    recordTurn({ model: 'claude-opus-4-6', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }, seconds: 1 });
    const m = getSessionMetrics();
    // opus-4-6 = $5 in, $25 out
    expect(m.totalCostUsd).toBeCloseTo(30, 1);
  });
});

describe('resetSessionMetrics', () => {
  test('clears all state', () => {
    recordTurn({ model: 'gpt-5.4-mini', usage: { inputTokens: 1000, outputTokens: 500 }, seconds: 1 });
    resetSessionMetrics();
    expect(getSessionMetrics().turnCount).toBe(0);
    expect(getSessionMetrics().totalCostUsd).toBe(0);
  });
});
