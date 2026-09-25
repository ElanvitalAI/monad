// ── PFC-S4 P4: TerminationCheck LLM tool ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchTerminationCheck,
  buildTerminationCheckTool,
  DEFAULT_TERMINATION_RULE,
} from '../src/auto-research/tools/termination-check';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { resolveGoalPaths } from '../src/auto-research/goal-paths';
import type { TerminationRule } from '../src/auto-research/termination-dsl';

async function makeGoal(slug: string, termination?: TerminationRule, budget?: any) {
  const home = mkdtempSync(join(tmpdir(), 'tc-tool-'));
  const vault = discoverObsidianVault({
    env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  const input: any = {
    action: 'init',
    goal_slug: slug,
    mission: 'test mission',
  };
  if (termination) input.termination = termination;
  if (budget) input.budget = budget;
  await dispatchResearchPlan(input, { vault });
  return { vault, slug };
}

describe('PFC-S4 P4 — TerminationCheck tool', () => {
  test('missing goal_slug throws', async () => {
    await expect(
      dispatchTerminationCheck({} as any),
    ).rejects.toThrow(/goal_slug is required/);
  });

  test('uninitialised goal throws', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tc-missing-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    await expect(
      dispatchTerminationCheck({ goal_slug: 'nope' }, { vault }),
    ).rejects.toThrow(/not initialised/);
  });

  test('default rule used when ACTIVE.md has no termination block', async () => {
    const { vault, slug } = await makeGoal('d1');
    const res = await dispatchTerminationCheck({ goal_slug: slug }, { vault });
    expect(res.rule_source).toBe('default');
    expect(res.rule).toEqual(DEFAULT_TERMINATION_RULE);
    // No summary written → unsatisfied
    expect(res.should_terminate).toBe(false);
    expect(res.unsatisfied).toContain('summary_written');
  });

  test('active_md rule picked from init-written block', async () => {
    const { vault, slug } = await makeGoal('d2', {
      kind: 'and',
      rules: [
        { kind: 'all_questions_answered', queuePath: 'question-queue.md' },
      ],
    });
    const res = await dispatchTerminationCheck({ goal_slug: slug }, { vault });
    expect(res.rule_source).toBe('active_md');
    expect(res.rule.kind).toBe('and');
    expect(res.should_terminate).toBe(true);  // empty queue → satisfied
  });

  test('rule_override takes precedence over ACTIVE.md', async () => {
    const { vault, slug } = await makeGoal('d3', {
      kind: 'all_questions_answered', queuePath: 'question-queue.md',
    });
    const res = await dispatchTerminationCheck(
      {
        goal_slug: slug,
        rule_override: { kind: 'summary_written', path: 'executive-summary.md', minChars: 100 },
      },
      { vault },
    );
    expect(res.rule_source).toBe('override');
    expect(res.should_terminate).toBe(false);  // no summary written
  });

  test('summary_written satisfied when file exists with minChars', async () => {
    const { vault, slug } = await makeGoal('d4');
    const paths = resolveGoalPaths(vault, slug);
    writeFileSync(paths.summary, 'A'.repeat(250), 'utf-8');
    // Also write wallclock budget so budget_remaining_min is ok
    // (DEFAULT_TERMINATION_RULE also checks budget ≥ 5% — we've allocated nothing so ratio is undefined=unlimited=ok).
    const res = await dispatchTerminationCheck({ goal_slug: slug }, { vault });
    expect(res.satisfied).toContain('summary_written');
    expect(res.should_terminate).toBe(true);
  });

  test('composite and/or aggregates correctly', async () => {
    const { vault, slug } = await makeGoal('d5');
    const paths = resolveGoalPaths(vault, slug);
    writeFileSync(paths.summary, 'X'.repeat(250), 'utf-8');
    writeFileSync(paths.sources, '- https://one.example\n- https://two.example\n- https://three.example\n', 'utf-8');
    const res = await dispatchTerminationCheck(
      {
        goal_slug: slug,
        rule_override: {
          kind: 'and',
          rules: [
            { kind: 'summary_written', path: 'executive-summary.md', minChars: 100 },
            { kind: 'min_sources', n: 3, sourcesPath: 'knowledge/sources.md' },
          ],
        },
      },
      { vault },
    );
    expect(res.should_terminate).toBe(true);
    expect(res.satisfied).toContain('and');
  });

  test('rule_override with unknown kind throws', async () => {
    const { vault, slug } = await makeGoal('d6');
    await expect(
      dispatchTerminationCheck(
        { goal_slug: slug, rule_override: { kind: 'not_real' } as any },
        { vault },
      ),
    ).rejects.toThrow(/unknown kind/);
  });

  test('invalid nested rule shape throws with path', async () => {
    const { vault, slug } = await makeGoal('d7');
    await expect(
      dispatchTerminationCheck(
        {
          goal_slug: slug,
          rule_override: {
            kind: 'and',
            rules: [{ kind: 'min_sources', n: 'three' } as any],
          },
        },
        { vault },
      ),
    ).rejects.toThrow(/min_sources requires/);
  });

  test('malformed ACTIVE.md termination block falls back to default + notice', async () => {
    const { vault, slug } = await makeGoal('d8');
    const paths = resolveGoalPaths(vault, slug);
    writeFileSync(paths.active, '---\nmission: test\n---\n\n## Termination rule\n\n```json\n{ not valid json\n```\n', 'utf-8');
    const res = await dispatchTerminationCheck({ goal_slug: slug }, { vault });
    expect(res.rule_source).toBe('default');
    expect(res.notices?.[0]).toMatch(/parse failed|invalid/);
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildTerminationCheckTool();
    expect(spec.name).toBe('TerminationCheck');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['goal_slug']);
  });
});
