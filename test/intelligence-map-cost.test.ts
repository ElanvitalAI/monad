// ── PFC-S5 P2: cost-meter ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COST_WARNING_RATIO,
  getCostConfigPath,
  getCostEventPath,
  loadCostConfig,
  logUsage,
  persistCostConfig,
  snapshotCost,
  weeklyCapStatus,
  monthlyCapStatus,
} from '../src/intelligence-map/cost-meter';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import {
  dispatchEnterAutoMode,
  resetAutoModeForTest,
} from '../src/auto-research/auto-mode';

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'cost-meter-'));
}

describe('PFC-S5 P2 — cost-meter', () => {
  beforeEach(() => { resetAutoModeForTest(); });

  test('logUsage appends a JSONL line', async () => {
    const home = scratchHome();
    const ev = await logUsage(
      { modelId: 'gpt-4o', inputTokens: 500, outputTokens: 200, usd: 0.002 },
      { home, skipAutoAttribution: true },
    );
    expect(ev.modelId).toBe('gpt-4o');
    const path = getCostEventPath(home);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, 'utf-8');
    expect(raw.split('\n').filter(Boolean).length).toBe(1);
  });

  test('snapshotCost aggregates total + perModel + perGoal', async () => {
    const home = scratchHome();
    await logUsage({ modelId: 'm1', inputTokens: 100, outputTokens: 100, usd: 0.1 }, { home, skipAutoAttribution: true });
    await logUsage({ modelId: 'm1', inputTokens: 100, outputTokens: 100, usd: 0.1, goalSlug: 'g1' }, { home, skipAutoAttribution: true });
    await logUsage({ modelId: 'm2', inputTokens: 50, outputTokens: 50, usd: 0.05, goalSlug: 'g1' }, { home, skipAutoAttribution: true });
    const snap = snapshotCost({ home });
    expect(snap.totalUsd).toBeCloseTo(0.25);
    expect(snap.eventsCount).toBe(3);
    expect(snap.perModel.m1?.count).toBe(2);
    expect(snap.perModel.m1?.tokens).toBe(400);
    expect(snap.perModel.m2?.usd).toBeCloseTo(0.05);
    expect(snap.perGoal.g1?.usd).toBeCloseTo(0.15);
    expect(snap.perGoal.g1?.tokens).toBe(300);
  });

  test('weekly rollup skips events older than 7 days', async () => {
    const home = scratchHome();
    const now = 1_700_000_000_000;
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    await logUsage({ modelId: 'm', inputTokens: 10, outputTokens: 10, usd: 1 }, { home, now: eightDaysAgo, skipAutoAttribution: true });
    await logUsage({ modelId: 'm', inputTokens: 10, outputTokens: 10, usd: 2 }, { home, now, skipAutoAttribution: true });
    const snap = snapshotCost({ home, now });
    expect(snap.totalUsd).toBe(3);
    expect(snap.weeklyUsd).toBe(2);
    expect(snap.monthlyUsd).toBe(3);
  });

  test('monthly rollup skips events older than 30 days', async () => {
    const home = scratchHome();
    const now = 1_700_000_000_000;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    await logUsage({ modelId: 'm', inputTokens: 0, outputTokens: 0, usd: 5 }, { home, now: thirtyOneDaysAgo, skipAutoAttribution: true });
    await logUsage({ modelId: 'm', inputTokens: 0, outputTokens: 0, usd: 1 }, { home, now, skipAutoAttribution: true });
    const snap = snapshotCost({ home, now });
    expect(snap.monthlyUsd).toBe(1);
    expect(snap.totalUsd).toBe(6);
  });

  test('MONAD_COST_EVENTS env override', async () => {
    const home = scratchHome();
    const custom = join(home, 'foo.jsonl');
    await logUsage(
      { modelId: 'x', inputTokens: 1, outputTokens: 1, usd: 0.1 },
      { env: { MONAD_COST_EVENTS: custom }, home, skipAutoAttribution: true },
    );
    expect(existsSync(custom)).toBe(true);
  });

  test('loadCostConfig + persist round-trip', () => {
    const home = scratchHome();
    persistCostConfig({ weeklyCapUsd: 5, monthlyCapUsd: 20 }, { home });
    const loaded = loadCostConfig({ home });
    expect(loaded.weeklyCapUsd).toBe(5);
    expect(loaded.monthlyCapUsd).toBe(20);
  });

  test('loadCostConfig missing file → {}', () => {
    const home = scratchHome();
    expect(loadCostConfig({ home })).toEqual({});
  });

  test('weeklyCapStatus ok / warning / tripped', async () => {
    const home = scratchHome();
    const now = 1_700_000_000_000;
    const config = { weeklyCapUsd: 10 };
    // Empty
    let snap = snapshotCost({ home, now });
    expect(weeklyCapStatus(snap, config)).toBe('ok');
    // 90% = 9
    await logUsage({ modelId: 'm', inputTokens: 0, outputTokens: 0, usd: 9 }, { home, now, skipAutoAttribution: true });
    snap = snapshotCost({ home, now });
    expect(weeklyCapStatus(snap, config)).toBe('warning');
    // 100% = 10
    await logUsage({ modelId: 'm', inputTokens: 0, outputTokens: 0, usd: 1.5 }, { home, now, skipAutoAttribution: true });
    snap = snapshotCost({ home, now });
    expect(weeklyCapStatus(snap, config)).toBe('tripped');
  });

  test('monthlyCapStatus independent of weekly', async () => {
    const home = scratchHome();
    const now = 1_700_000_000_000;
    await logUsage({ modelId: 'm', inputTokens: 0, outputTokens: 0, usd: 95 }, { home, now, skipAutoAttribution: true });
    const snap = snapshotCost({ home, now });
    expect(monthlyCapStatus(snap, { monthlyCapUsd: 100 })).toBe('warning');
  });

  test('auto-attribution fills goalSlug when auto-mode active', async () => {
    const home = scratchHome();
    const vaultHome = mkdtempSync(join(tmpdir(), 'cost-vault-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(vaultHome, 'vault') },
      cwd: vaultHome,
    });
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'cost-goal', mission: 'M', budget: { tokens: 100_000, usd: 10 } },
      { vault },
    );
    await dispatchEnterAutoMode({ goal_slug: 'cost-goal' }, { vault });

    // Auto-mode active — log without explicit goalSlug; test-seam budgetDispatch
    // captures the call.
    let capturedSlug = '';
    let capturedUsd = 0;
    const ev = await logUsage(
      { modelId: 'm', inputTokens: 500, outputTokens: 500, usd: 0.25 },
      {
        home,
        budgetDispatch: async (slug, _tokens, usd) => {
          capturedSlug = slug;
          capturedUsd = usd;
        },
      },
    );
    expect(ev.goalSlug).toBe('cost-goal');
    expect(capturedSlug).toBe('cost-goal');
    expect(capturedUsd).toBeCloseTo(0.25);
  });

  test('logUsage negative tokens throws', async () => {
    const home = scratchHome();
    await expect(
      logUsage({ modelId: 'm', inputTokens: -1, outputTokens: 0, usd: 0 }, { home, skipAutoAttribution: true }),
    ).rejects.toThrow(/invalid inputTokens/);
  });

  test('snapshotCost tolerant to partially corrupt JSONL', async () => {
    const home = scratchHome();
    const path = getCostEventPath(home);
    const fs = require('node:fs');
    fs.mkdirSync(path.substring(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path,
      JSON.stringify({ ts: 100, modelId: 'ok', inputTokens: 0, outputTokens: 0, usd: 1 }) + '\n' +
      '{broken line\n' +
      JSON.stringify({ ts: 200, modelId: 'ok', inputTokens: 0, outputTokens: 0, usd: 2 }) + '\n');
    const snap = snapshotCost({ home, now: 1_700_000_000_000 });
    expect(snap.eventsCount).toBe(2);
    expect(snap.totalUsd).toBe(3);
  });

  test('COST_WARNING_RATIO sanity', () => {
    expect(COST_WARNING_RATIO).toBeGreaterThan(0.5);
    expect(COST_WARNING_RATIO).toBeLessThan(1);
  });
});
