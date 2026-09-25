import { describe, expect, test } from 'bun:test';

import { debug } from '../src/debug/log.js';
import {
  recordDashboardTurnMetrics,
  runDashboardTurnUsageRuntime,
} from '../src/dashboard/turn-metrics-runtime.js';

describe('runDashboardTurnUsageRuntime', () => {
  test('records usage, logs a muted line, and redraws', async () => {
    const calls: string[] = [];
    runDashboardTurnUsageRuntime({
      usage: { inputTokens: 10, outputTokens: 5 },
      importPromptCache: async () => ({
        formatUsageLine: () => 'usage line',
        recordUsage: () => { calls.push('record'); },
      }),
      pushDebugLine: (line) => { calls.push(`debug:${line}`); },
      muted: (text) => `muted:${text}`,
      draw: () => { calls.push('draw'); },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      'record',
      'debug:muted:  usage line',
      'draw',
    ]);
  });
});

describe('recordDashboardTurnMetrics', () => {
  test('records provider usage when input tokens are numeric', async () => {
    const calls: Array<Record<string, unknown>> = [];
    await recordDashboardTurnMetrics({
      chatHistory: [] as any,
      model: 'gpt-test',
      fullResponse: 'ignored when usage is present',
      turnStartedAt: Date.now(),
      usage: { inputTokens: 40_449, outputTokens: 6, cacheReadInputTokens: 11_776 },
      importStatusMetrics: async () => ({
        recordTurn: (input) => { calls.push(input); },
      }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: 'gpt-test',
      usage: {
        inputTokens: 40_449,
        outputTokens: 6,
        cacheReadTokens: 11_776,
      },
    });
    expect(calls[0]).not.toHaveProperty('estimatedPromptText');
    expect(debug.events(1).at(-1)).toMatchObject({
      category: 'dashboard.turn-metrics',
      event: 'context-source',
      data: { source: 'provider-usage', inputTokens: 40_449 },
    });
  });

  test('records the latest prompt pair and response text when usage is absent', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const originalNow = Date.now;
    Date.now = () => 5_000;
    try {
      await recordDashboardTurnMetrics({
        chatHistory: [
          { role: 'system', content: 'ignore' },
          { role: 'user', content: 'question' },
          { role: 'assistant', content: 'answer draft' },
        ] as any,
        model: 'gpt-test',
        fullResponse: 'final answer',
        turnStartedAt: 3_000,
        importStatusMetrics: async () => ({
          recordTurn: (input) => { calls.push(input); },
        }),
      });
    } finally {
      Date.now = originalNow;
    }
    expect(calls).toEqual([{
      model: 'gpt-test',
      estimatedPromptText: 'question\nanswer draft',
      estimatedOutputText: 'final answer',
      seconds: 2,
    }]);
    expect(debug.events(1).at(-1)).toMatchObject({
      category: 'dashboard.turn-metrics',
      event: 'context-source',
      data: { source: 'estimate', inputTokens: undefined },
    });
  });
});
