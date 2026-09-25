// ── PFC-S4 P1: ResearchPlan LLM tool ──

import { describe, test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchResearchPlan,
  buildResearchPlanTool,
} from '../src/auto-research/tools/research-plan';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { resolveGoalPaths, isValidGoalSlug } from '../src/auto-research/goal-paths';

function scratchVault() {
  const home = mkdtempSync(join(tmpdir(), 'rp-tool-home-'));
  mkdirSync(join(home, 'Obsidian'), { recursive: true });
  // discover picks the fallback via Documents; easier to use env override.
  const vault = discoverObsidianVault({
    env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  return { home, vault };
}

describe('PFC-S4 P1 — goal-paths', () => {
  test('isValidGoalSlug accepts lowercase-hyphen', () => {
    expect(isValidGoalSlug('samsung-2026-q2')).toBe(true);
    expect(isValidGoalSlug('a')).toBe(true);
    expect(isValidGoalSlug('foo_bar-9')).toBe(true);
  });

  test('isValidGoalSlug rejects uppercase / spaces / slash', () => {
    expect(isValidGoalSlug('Samsung')).toBe(false);
    expect(isValidGoalSlug('two words')).toBe(false);
    expect(isValidGoalSlug('path/sep')).toBe(false);
    expect(isValidGoalSlug('')).toBe(false);
  });

  test('resolveGoalPaths throws on invalid slug', () => {
    const { vault } = scratchVault();
    expect(() => resolveGoalPaths(vault, '../escape')).toThrow(/invalid goal_slug/);
  });

  test('resolveGoalPaths returns expected file anchors', () => {
    const { vault } = scratchVault();
    const p = resolveGoalPaths(vault, 'x1');
    expect(p.goalRoot).toBe(join(vault.root, 'goals', 'x1'));
    expect(p.plan.endsWith('plan.md')).toBe(true);
    expect(p.queue.endsWith('question-queue.md')).toBe(true);
    expect(p.wins.endsWith(join('knowledge', 'wins.md'))).toBe(true);
    expect(p.budgetFile.endsWith('budget.json')).toBe(true);
  });
});

describe('PFC-S4 P1 — ResearchPlan tool', () => {
  test('init creates goal dir + ACTIVE.md + budget.json', async () => {
    const { vault } = scratchVault();
    const res = await dispatchResearchPlan(
      {
        action: 'init',
        goal_slug: 'test-goal',
        mission: 'Learn PFC flow',
        deadline: '2026-05-01T00:00:00Z',
        budget: { tokens: 100_000, usd: 1.5 },
      },
      { vault, now: 1_700_000_000_000 },
    );
    const paths = resolveGoalPaths(vault, 'test-goal');
    expect(existsSync(paths.goalRoot)).toBe(true);
    expect(existsSync(paths.active)).toBe(true);
    expect(existsSync(paths.plan)).toBe(true);
    expect(existsSync(paths.queue)).toBe(true);
    expect(existsSync(paths.budgetFile)).toBe(true);
    expect(res.created).toBe(true);
    expect(res.mission).toBe('Learn PFC flow');
    expect(res.deadline).toBe('2026-05-01T00:00:00Z');
    expect(res.budget?.remaining.tokens).toBe(100_000);
  });

  test('init without mission on new slug throws', async () => {
    const { vault } = scratchVault();
    await expect(
      dispatchResearchPlan({ action: 'init', goal_slug: 'no-mission' }, { vault }),
    ).rejects.toThrow(/mission is required/);
  });

  test('init twice is idempotent and preserves first mission', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'idemp', mission: 'First' },
      { vault },
    );
    const res = await dispatchResearchPlan(
      { action: 'init', goal_slug: 'idemp', mission: 'Second', budget: { usd: 5 } },
      { vault },
    );
    expect(res.mission).toBe('First');
    expect(res.created).toBe(false);
    expect(res.notices?.some(n => n.includes('already exists'))).toBe(true);
  });

  test('read returns mission + plan + budget snapshot', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'r1', mission: 'R1 mission', budget: { tokens: 10_000 } },
      { vault },
    );
    const res = await dispatchResearchPlan({ action: 'read', goal_slug: 'r1' }, { vault });
    expect(res.mission).toBe('R1 mission');
    expect(res.plan).toContain('R1 mission');
    expect(res.queue_pending_count).toBe(0);
    expect(res.wins_count).toBe(0);
    expect(res.has_summary).toBe(false);
    expect(res.budget?.remaining.tokens).toBe(10_000);
    expect(res.budget_line?.includes('tokens')).toBe(true);
  });

  test('read on missing goal throws', async () => {
    const { vault } = scratchVault();
    await expect(
      dispatchResearchPlan({ action: 'read', goal_slug: 'missing' }, { vault }),
    ).rejects.toThrow(/does not exist/);
  });

  test('update_plan overwrites plan.md and reports char count notice', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan(
      { action: 'init', goal_slug: 'up', mission: 'M' },
      { vault },
    );
    const res = await dispatchResearchPlan(
      { action: 'update_plan', goal_slug: 'up', plan: '# strategy\n\nstep 1 — probe' },
      { vault },
    );
    expect(res.plan).toContain('step 1 — probe');
    expect(res.notices?.some(n => n.includes('plan.md updated'))).toBe(true);
    const raw = readFileSync(resolveGoalPaths(vault, 'up').plan, 'utf-8');
    expect(raw).toContain('step 1 — probe');
  });

  test('append_win then append_source increment counts', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan({ action: 'init', goal_slug: 'a', mission: 'M' }, { vault });
    await dispatchResearchPlan({ action: 'append_win', goal_slug: 'a', win: 'solved X' }, { vault });
    await dispatchResearchPlan({ action: 'append_win', goal_slug: 'a', win: 'solved Y' }, { vault });
    await dispatchResearchPlan({ action: 'append_source', goal_slug: 'a', source: 'https://example.com/a' }, { vault });
    const res = await dispatchResearchPlan({ action: 'read', goal_slug: 'a' }, { vault });
    expect(res.wins_count).toBe(2);
    expect(res.sources_count).toBe(1);
  });

  test('write_now + write_summary round-trip', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan({ action: 'init', goal_slug: 's', mission: 'M' }, { vault });
    await dispatchResearchPlan({ action: 'write_now', goal_slug: 's', now: 'turn 3 → derive wave 2' }, { vault });
    await dispatchResearchPlan({ action: 'write_summary', goal_slug: 's', summary: 'Final verdict: HOLD' }, { vault });
    const res = await dispatchResearchPlan({ action: 'read', goal_slug: 's' }, { vault });
    expect(res.now_note).toContain('turn 3');
    expect(res.has_summary).toBe(true);
    expect(res.summary).toContain('HOLD');
  });

  test('list_goals enumerates all initialised goals sorted by createdAt', async () => {
    const { vault } = scratchVault();
    await dispatchResearchPlan({ action: 'init', goal_slug: 'g1', mission: 'A' }, { vault, now: 1 });
    await dispatchResearchPlan({ action: 'init', goal_slug: 'g2', mission: 'B' }, { vault, now: 2 });
    await dispatchResearchPlan({ action: 'init', goal_slug: 'g3', mission: 'C', deadline: 'deadline-str' }, { vault, now: 3 });
    const res = await dispatchResearchPlan({ action: 'list_goals' }, { vault });
    expect(res.goals?.length).toBe(3);
    expect(res.goals?.map(g => g.slug)).toEqual(['g1', 'g2', 'g3']);
    expect(res.goals?.[2]?.deadline).toBe('deadline-str');
  });

  test('append_win on uninitialised goal throws', async () => {
    const { vault } = scratchVault();
    await expect(
      dispatchResearchPlan({ action: 'append_win', goal_slug: 'nope', win: 'x' }, { vault }),
    ).rejects.toThrow(/not initialised/);
  });

  test('missing goal_slug on read throws', async () => {
    const { vault } = scratchVault();
    await expect(
      dispatchResearchPlan({ action: 'read' } as any, { vault }),
    ).rejects.toThrow(/requires goal_slug/);
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildResearchPlanTool();
    expect(spec.name).toBe('ResearchPlan');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    const props = params.properties as Record<string, unknown>;
    expect(props.action).toBeDefined();
    expect(params.required).toEqual(['action']);
  });
});
