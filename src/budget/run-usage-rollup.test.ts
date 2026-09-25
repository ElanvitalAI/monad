import { describe, expect, it } from 'bun:test';
import { rollupRunUsage } from './run-usage-rollup.js';

describe('rollupRunUsage', () => {
  it('groups by the complete run/model/billing-provider/billing tuple and collects distinct hosts', () => {
    const rows = rollupRunUsage([
      { runId: 'run', model: 'm', billingProvider: 'gateway', billing: 'api', hostId: 'h1', inputTokens: 2, outputTokens: 3, cost: { kind: 'actual', usd: 1 } },
      { runId: 'run', model: 'm', billingProvider: 'gateway', billing: 'api', hostId: 'h2', inputTokens: 5, outputTokens: 7, cost: { kind: 'known', usd: 2 } },
      { runId: 'run', model: 'm', billingProvider: 'gateway', billing: 'api', hostId: 'h1', cacheReadInputTokens: 11, cacheCreationInputTokens: 13, reasoningOutputTokens: 17, cost: { kind: 'partial', usd: 0.5 } },
      { runId: 'other', model: 'm', billingProvider: 'gateway', billing: 'api' },
      { runId: 'run', model: 'other', billingProvider: 'gateway', billing: 'api' },
      { runId: 'run', model: 'm', billingProvider: 'other', billing: 'api' },
      { runId: 'run', model: 'm', billingProvider: 'gateway', billing: 'subscription', cost: { kind: 'included', usd: 0, apiEquivalentUsd: 4 } },
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      runId: 'run', model: 'm', billingProvider: 'gateway', billing: 'api', hostIds: ['h1', 'h2'],
      calls: 3, inputTokens: 7, outputTokens: 10, cacheReadInputTokens: 11,
      cacheCreationInputTokens: 13, reasoningOutputTokens: 17,
      usdKnown: 3.5, unknownCostCalls: 1, includedCalls: 0, apiEquivalentUsd: 0,
    });
    expect(rows[4]).toMatchObject({ calls: 1, includedCalls: 1, unknownCostCalls: 0, usdKnown: 0, apiEquivalentUsd: 4 });
  });

  it('uses (none) for absent runId and keeps missing or unknown costs separate from known zero', () => {
    const rows = rollupRunUsage([
      { model: 'm', billingProvider: 'p', billing: 'api', cost: { kind: 'unknown' } },
      { runId: null, model: 'm', billingProvider: 'p', billing: 'api' },
      { model: 'm', billingProvider: 'p', billing: 'api', cost: { kind: 'known', usd: 0 } },
      { model: 'm', billingProvider: 'p', billing: 'api', cost: { kind: 'actual', usd: Number.NaN } },
      { model: 'm', billingProvider: 'p', billing: 'api', inputTokens: Number.NaN, cost: { kind: 'partial', usd: 1.25 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: '(none)', calls: 5, hostIds: [], inputTokens: 0, usdKnown: 1.25, unknownCostCalls: 4 });
    expect(rollupRunUsage([])).toEqual([]);
  });

  it('does not collide when tuple components contain separators', () => {
    const rows = rollupRunUsage([
      { runId: 'a|b', model: 'c', billingProvider: 'p', billing: 'api' },
      { runId: 'a', model: 'b|c', billingProvider: 'p', billing: 'api' },
    ]);
    expect(rows).toHaveLength(2);
  });
});
