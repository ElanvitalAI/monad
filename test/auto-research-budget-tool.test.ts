// ── PFC-S4 P3: Budget LLM tool ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchBudget,
  buildBudgetTool,
} from '../src/auto-research/tools/budget';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { resolveGoalPaths } from '../src/auto-research/goal-paths';

async function makeGoal(slug: string, budget?: { tokens?: number; usd?: number; weeklyUsd?: number; wallclockMs?: number }) {
  const home = mkdtempSync(join(tmpdir(), 'budget-tool-'));
  const vault = discoverObsidianVault({
    env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  const initInput: any = { action: 'init', goal_slug: slug, mission: 'test' };
  if (budget) initInput.budget = budget;
  await dispatchResearchPlan(initInput, { vault, now: 1_700_000_000_000 });
  return { vault, slug };
}

describe('PFC-S4 P3 — Budget tool', () => {
  test('snapshot on new goal returns spec-bounded remaining', async () => {
    const { vault, slug } = await makeGoal('b1', { tokens: 10_000, usd: 2.5 });
    const res = await dispatchBudget(
      { action: 'snapshot', goal_slug: slug },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.snapshot.remaining.tokens).toBe(10_000);
    expect(res.snapshot.remaining.usd).toBe(2.5);
    expect(res.snapshot.tripped).toEqual([]);
    expect(res.budget_line).toContain('tokens 0/10k');
  });

  test('add increments and persists', async () => {
    const { vault, slug } = await makeGoal('b2', { tokens: 10_000, usd: 2.5 });
    const res = await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { tokens: 2500, usd: 0.50 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.snapshot.tokens).toBe(2500);
    expect(res.snapshot.usd).toBe(0.50);
    expect(res.snapshot.remaining.tokens).toBe(7500);
    // Verify persistence
    const paths = resolveGoalPaths(vault, slug);
    const raw = JSON.parse(readFileSync(paths.budgetFile, 'utf-8'));
    expect(raw.usage.tokens).toBe(2500);
    expect(raw.spec.tokens).toBe(10_000);
  });

  test('add warning axis detected at ≥90%', async () => {
    const { vault, slug } = await makeGoal('b3', { tokens: 1000 });
    const res = await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { tokens: 950 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.snapshot.warning).toContain('tokens');
    expect(res.notices?.some(n => n.includes('warning'))).toBe(true);
  });

  test('add tripped axis produces TRIPPED notice', async () => {
    const { vault, slug } = await makeGoal('b4', { usd: 1 });
    const res = await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { usd: 1.5 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.snapshot.tripped).toContain('usd');
    expect(res.notices?.some(n => n.includes('TRIPPED'))).toBe(true);
  });

  test('can_afford true when remaining ≥ required', async () => {
    const { vault, slug } = await makeGoal('b5', { tokens: 10_000, usd: 5 });
    await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { tokens: 1000, usd: 0.5 } },
      { vault, now: 1_700_000_000_000 },
    );
    const res = await dispatchBudget(
      { action: 'can_afford', goal_slug: slug, required: { tokens: 5000, usd: 2 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.can_afford).toBe(true);
    expect(res.reason).toBe('within budget');
  });

  test('can_afford false with per-axis miss reason', async () => {
    const { vault, slug } = await makeGoal('b6', { tokens: 10_000 });
    await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { tokens: 9500 } },
      { vault, now: 1_700_000_000_000 },
    );
    const res = await dispatchBudget(
      { action: 'can_afford', goal_slug: slug, required: { tokens: 2000 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.can_afford).toBe(false);
    expect(res.reason).toContain('tokens remaining 500');
  });

  test('can_afford ignores uncapped axes (undefined required)', async () => {
    const { vault, slug } = await makeGoal('b7', { usd: 5 });
    // tokens axis is uncapped — only usd required
    const res = await dispatchBudget(
      { action: 'can_afford', goal_slug: slug, required: { tokens: 9_999_999, usd: 0.1 } },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.can_afford).toBe(true);
  });

  test('reset_weekly zeros weeklyUsd', async () => {
    const { vault, slug } = await makeGoal('b8', { weeklyUsd: 10 });
    await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { weeklyUsd: 7 } },
      { vault, now: 1_700_000_000_000 },
    );
    const res = await dispatchBudget(
      { action: 'reset_weekly', goal_slug: slug },
      { vault, now: 1_700_000_000_000 },
    );
    expect(res.snapshot.weeklyUsd).toBe(0);
    expect(res.notices?.[0]).toContain('weeklyUsd reset');
  });

  test('negative delta throws', async () => {
    const { vault, slug } = await makeGoal('b9', { tokens: 100 });
    await expect(
      dispatchBudget(
        { action: 'add', goal_slug: slug, delta: { tokens: -10 } },
        { vault },
      ),
    ).rejects.toThrow(/negative/);
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildBudgetTool();
    expect(spec.name).toBe('Budget');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['action', 'goal_slug']);
  });
});
