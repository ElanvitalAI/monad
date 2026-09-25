// C1 — broadcast cost estimator unit tests.

import { describe, test, expect } from 'bun:test';
import {
  DEFAULT_BROADCAST_COST_WARN_TOKENS,
  estimateBroadcastCost,
  estimateTokensFromChars,
} from './cost-estimator';
import type { ShowroomPanel } from './types';

const panel = (id: string, provider: string): ShowroomPanel => ({
  id,
  kind: 'chat',
  provider,
  sessionId: null,
  state: 'live',
});

describe('estimateTokensFromChars', () => {
  test('empty string → 0 tokens', () => {
    expect(estimateTokensFromChars('')).toBe(0);
  });

  test('char/4 ceil', () => {
    expect(estimateTokensFromChars('abcd')).toBe(1);    // 4/4 = 1
    expect(estimateTokensFromChars('abcde')).toBe(2);   // ceil(5/4) = 2
    expect(estimateTokensFromChars('a'.repeat(40))).toBe(10);
  });
});

describe('estimateBroadcastCost', () => {
  const panels = [panel('p1', 'codex'), panel('p2', 'claude'), panel('p3', 'gemini')];

  test('empty targets → totalTokens = 0', () => {
    const e = estimateBroadcastCost({
      dispatchText: 'hello',
      dmTargets: [],
      allPanels: panels,
    });
    expect(e.totalTokens).toBe(0);
    expect(e.perPanel).toEqual([]);
    expect(e.exceedsWarnThreshold).toBe(false);
  });

  test('isolated mode — input × N targets', () => {
    const e = estimateBroadcastCost({
      dispatchText: 'a'.repeat(40), // 10 tokens
      dmTargets: panels,
      allPanels: panels,
    });
    expect(e.perPanel).toHaveLength(3);
    e.perPanel.forEach((p) => {
      expect(p.inputTokens).toBe(10);
      expect(p.priorTokens).toBe(0);
      expect(p.totalTokens).toBe(10);
    });
    expect(e.totalTokens).toBe(30); // 10 × 3
  });

  test('mixed mode — sibling priors add to per-panel cost', () => {
    const e = estimateBroadcastCost({
      dispatchText: 'a'.repeat(40), // 10 tokens
      dmTargets: panels,
      allPanels: panels,
      lastAssistantByPanelId: {
        p1: 'b'.repeat(80),  // 20 tokens
        p2: 'c'.repeat(120), // 30 tokens
        // p3 has no prior → 0
      },
    });
    expect(e.perPanel[0]!.priorTokens).toBe(20);
    expect(e.perPanel[0]!.totalTokens).toBe(30);
    expect(e.perPanel[1]!.priorTokens).toBe(30);
    expect(e.perPanel[1]!.totalTokens).toBe(40);
    expect(e.perPanel[2]!.priorTokens).toBe(0);
    expect(e.perPanel[2]!.totalTokens).toBe(10);
    expect(e.totalTokens).toBe(80); // 30 + 40 + 10
  });

  test('exceedsWarnThreshold reflects total vs threshold', () => {
    const small = estimateBroadcastCost({
      dispatchText: 'a'.repeat(40),
      dmTargets: panels,
      allPanels: panels,
      warnThreshold: 100,
    });
    expect(small.totalTokens).toBe(30);
    expect(small.exceedsWarnThreshold).toBe(false);

    const big = estimateBroadcastCost({
      dispatchText: 'a'.repeat(40),
      dmTargets: panels,
      allPanels: panels,
      warnThreshold: 20,
    });
    expect(big.totalTokens).toBe(30);
    expect(big.exceedsWarnThreshold).toBe(true);
  });

  test('default threshold = DEFAULT_BROADCAST_COST_WARN_TOKENS', () => {
    const e = estimateBroadcastCost({
      dispatchText: 'a'.repeat(40),
      dmTargets: panels,
      allPanels: panels,
    });
    expect(e.warnThreshold).toBe(DEFAULT_BROADCAST_COST_WARN_TOKENS);
  });

  test('per-panel displayName honors D12 numeric suffix (duplicate provider)', () => {
    const dupPanels = [panel('p1', 'claude'), panel('p2', 'claude'), panel('p3', 'codex')];
    const e = estimateBroadcastCost({
      dispatchText: 'x',
      dmTargets: dupPanels,
      allPanels: dupPanels,
    });
    expect(e.perPanel[0]!.displayName).toBe('claude-1');
    expect(e.perPanel[1]!.displayName).toBe('claude-2');
    expect(e.perPanel[2]!.displayName).toBe('codex');
  });

  test('large mixed broadcast crosses default 50k threshold', () => {
    // 5 panels · each ~12k tokens (50k chars) → totalTokens ~60k.
    const fivePanels = [
      panel('p1', 'codex'), panel('p2', 'claude'), panel('p3', 'gemini'),
      panel('p4', 'grok'), panel('p5', 'local-llm'),
    ];
    const e = estimateBroadcastCost({
      dispatchText: 'x'.repeat(50_000),
      dmTargets: fivePanels,
      allPanels: fivePanels,
    });
    expect(e.totalTokens).toBeGreaterThan(DEFAULT_BROADCAST_COST_WARN_TOKENS);
    expect(e.exceedsWarnThreshold).toBe(true);
  });
});
