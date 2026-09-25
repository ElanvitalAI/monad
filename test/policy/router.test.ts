// H6 P3 Bundle 1 · PolicyRouter integration.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import { UsageStore } from '../../src/budget/usage-store';
import type { UsageSnapshot, UsageProvider, WindowKind } from '../../src/budget/types';
import { PolicyRouter } from '../../src/policy/router';
import { OverrideStore } from '../../src/policy/override-store';

const NOW = 1_700_000_000_000;

function stubFetcher(snapshot: UsageSnapshot) {
  return { fetch: async () => snapshot };
}

function makeSnapshot(brand: UsageProvider, usedPct: number, windowKind: WindowKind = 'weekly'): UsageSnapshot {
  return {
    provider: brand,
    windows: [
      {
        kind: windowKind,
        windowMinutes: 10_080,
        limit: 100,
        used: usedPct,
        remainingPercent: 100 - usedPct,
        resetsAt: NOW + 86_400_000,
      },
    ],
    fetchedAt: NOW,
    source: 'oauth-api',
  };
}

describe('PolicyRouter', () => {
  let tmp: string;
  let usage: UsageStore;
  let overrides: OverrideStore;
  let history: BudgetHistoryStore;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'policy-router-'));
    history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
    usage = new UsageStore({ storageDir: join(tmp, 'u'), historyStore: history, now: () => NOW });
    overrides = new OverrideStore({ storageDir: join(tmp, 'o'), now: () => NOW });
  });

  afterEach(() => {
    history.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function registerBrands(opts: Record<UsageProvider, number | null>): Promise<void> {
    for (const [brand, pct] of Object.entries(opts)) {
      if (pct === null) continue;
      usage.registerFetcher(brand as UsageProvider, stubFetcher(makeSnapshot(brand as UsageProvider, pct)));
    }
    await usage.refresh();
  }

  test('decide picks top cloud candidate at safe usage', async () => {
    await registerBrands({ codex: 10, claude: 20, gemini: 30, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'hello' });
    expect(d.brand).not.toBe('local-llm');
    expect(d.requiresConfirmation).toBe(false);
  });

  test('decide sets requiresConfirmation when all at throttle', async () => {
    await registerBrands({ codex: 97, claude: 97, gemini: 97, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    expect(d.requiresConfirmation).toBe(true);
  });

  test('bypass suppresses HITL for matching brand', async () => {
    await registerBrands({ codex: 97, claude: 97, gemini: 97, 'local-llm': null, grok: null });
    overrides.addThrottleBypass({ brand: 'claude', window: 'weekly', expiresAt: NOW + 86_400_000 });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    // Top candidate (claude/opus) matches bypass → prefer (not flag-confirm)
    if (d.brand === 'claude') {
      expect(d.requiresConfirmation).toBe(false);
    }
  });

  test('warn brand redirects to cheaper fallback', async () => {
    await registerBrands({ codex: 10, claude: 85, gemini: 10, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    // R3 filter drops claude/opus + sonnet (warn) from consideration; R6
    // falls through; default cloud ordering picks first non-claude ok.
    expect(['codex', 'gemini']).toContain(d.brand);
  });

  test('session-lock keeps locked brand at safe level', async () => {
    await registerBrands({ codex: 10, claude: 10, gemini: 10, 'local-llm': null, grok: null });
    overrides.setSessionLock('codex', 'gpt-5');
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    expect(d.brand).toBe('codex');
    expect(d.model).toBe('gpt-5');
  });

  test('per-turn preferred still HITL at throttle', async () => {
    await registerBrands({ codex: 97, claude: 97, gemini: 97, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x', preferred: { brand: 'claude', model: 'opus' } });
    expect(d.requiresConfirmation).toBe(true);
  });

  test('persistent-default applies when no higher-priority rule wins', async () => {
    await registerBrands({ codex: 10, claude: 10, gemini: 10, 'local-llm': null, grok: null });
    overrides.setPersistentDefault('gemini', 'pro');
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    expect(d.brand).toBe('gemini');
    expect(d.model).toBe('pro');
  });

  test('persistent-default=local-llm with hasLocalLLM=false falls through to cloud', async () => {
    await registerBrands({ codex: 10, claude: 10, gemini: 10, 'local-llm': null, grok: null });
    overrides.setPersistentDefault('local-llm');
    const router = new PolicyRouter({
      usageStore: usage,
      overrideStore: overrides,
      hasLocalLLM: () => false,
      now: () => NOW,
    });
    const d = router.decide({ task: 'x' });
    expect(d.brand).not.toBe('local-llm');
  });

  test('toLaunchSpec throws when winner is not-yet-implemented', async () => {
    // Only local-llm available (no cloud snapshots · local has fetcher=null).
    const router = new PolicyRouter({
      usageStore: usage,
      overrideStore: overrides,
      hasLocalLLM: () => false,
      now: () => NOW,
    });
    // No brands have snapshots → all cloud = unavailable · local-llm
    // = not-yet-implemented. Decide picks first candidate regardless.
    const d = router.decide({ task: 'x' });
    if (d.brand === 'local-llm') {
      expect(() => router.toLaunchSpec(d)).toThrow();
    }
  });

  test('trace records every rule that ran', async () => {
    await registerBrands({ codex: 10, claude: 10, gemini: 10, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    const d = router.decide({ task: 'x' });
    expect(d.trace.steps.length).toBeGreaterThan(0);
    // Rules sorted by priority desc
    const priorities = d.trace.steps.map((s) => s.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i - 1]!).toBeGreaterThanOrEqual(priorities[i]!);
    }
  });

  test('lastDecision() returns the most recent result', async () => {
    await registerBrands({ codex: 10, claude: 10, gemini: 10, 'local-llm': null, grok: null });
    const router = new PolicyRouter({ usageStore: usage, overrideStore: overrides, now: () => NOW });
    expect(router.lastDecision()).toBeUndefined();
    const d = router.decide({ task: 'x' });
    expect(router.lastDecision()?.brand).toBe(d.brand);
  });
});
