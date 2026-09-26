// ── PFC-S4 P5: EnterAutoMode + ExitAutoMode + session singleton ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchEnterAutoMode,
  dispatchExitAutoMode,
  getAutoModeState,
  resetAutoModeForTest,
  subscribeAutoMode,
  generateAutoModeSessionId,
  isAutoModeActive,
  buildEnterAutoModeTool,
  buildExitAutoModeTool,
  AUTO_MODE_HARD_MAX_TURNS,
} from '../src/auto-research/auto-mode';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { dispatchBudget } from '../src/auto-research/tools/budget';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';

async function makeGoal(slug: string, budget?: any, termination?: any) {
  const home = mkdtempSync(join(tmpdir(), 'auto-mode-'));
  const vault = discoverObsidianVault({
    env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  const input: any = {
    action: 'init',
    goal_slug: slug,
    mission: 'test mission',
  };
  if (budget) input.budget = budget;
  if (termination) input.termination = termination;
  await dispatchResearchPlan(input, { vault });
  return { vault, slug };
}

describe('PFC-S4 P5 — auto-mode session + tools', () => {
  beforeEach(() => { resetAutoModeForTest(); });

  test('initial state is inactive', () => {
    expect(isAutoModeActive()).toBe(false);
    expect(getAutoModeState().phase).toBe('idle');
  });

  test('enter transitions to active with session_id + goal_root', async () => {
    const { vault, slug } = await makeGoal('e1');
    const res = await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(res.session_id).toBeDefined();
    expect(res.goal_slug).toBe(slug);
    expect(res.goal_root?.endsWith(join('goals', slug))).toBe(true);
    expect(res.loop_prompt).toContain('# Research Loop State');
    expect(isAutoModeActive()).toBe(true);
  });

  test('enter twice refuses', async () => {
    const { vault, slug } = await makeGoal('e2');
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    const res = await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(res.output).toMatch(/already active/);
  });

  test('enter with missing goal_slug fails', async () => {
    const res = await dispatchEnterAutoMode({} as any);
    expect(res.output).toMatch(/goal_slug is required/);
  });

  test('enter with uninitialised goal fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'auto-mode-nope-'));
    const vault = discoverObsidianVault({
      env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    const res = await dispatchEnterAutoMode({ goal_slug: 'missing' }, { vault });
    expect(res.output).toMatch(/not initialised/);
  });

  test('enter with tripped budget refuses', async () => {
    const { vault, slug } = await makeGoal('e5', { usd: 1 });
    await dispatchBudget(
      { action: 'add', goal_slug: slug, delta: { usd: 2 } },
      { vault },
    );
    const res = await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(res.output).toMatch(/budget tripped/);
    expect(isAutoModeActive()).toBe(false);
  });

  test('max_turns clamped to hard cap with notice', async () => {
    const { vault, slug } = await makeGoal('e6');
    const res = await dispatchEnterAutoMode(
      { goal_slug: slug, max_turns: 250 },
      { vault },
    );
    expect(res.max_turns).toBe(AUTO_MODE_HARD_MAX_TURNS);
    expect(res.notices?.some(n => n.includes('clamped'))).toBe(true);
  });

  test('termination_override reflected in rule_source', async () => {
    const { vault, slug } = await makeGoal('e7');
    const res = await dispatchEnterAutoMode(
      {
        goal_slug: slug,
        termination_override: { kind: 'summary_written', path: 'executive-summary.md', minChars: 100 },
      },
      { vault },
    );
    expect(res.termination_rule_source).toBe('override');
  });

  test('subscribe fires on enter', async () => {
    const { vault, slug } = await makeGoal('e8');
    let fired = 0;
    subscribeAutoMode(() => { fired++; });
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  test('exit from inactive fails', async () => {
    const res = await dispatchExitAutoMode({});
    expect(res.output).toMatch(/not active/);
  });

  test('exit returns final_state with reason', async () => {
    const { vault, slug } = await makeGoal('e10');
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    const res = await dispatchExitAutoMode(
      {
        reason: 'termination_met',
        summary: 'All objective conditions verified: question queue empty and executive-summary.md written.',
      },
      { vault },
    );
    expect(res.final_state?.exitReason).toBe('termination_met');
    expect(isAutoModeActive()).toBe(false);
  });

  test('termination_met without evidence summary is rejected (§5-②/2)', async () => {
    const { vault, slug } = await makeGoal('e10b');
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    const res = await dispatchExitAutoMode({ reason: 'termination_met' }, { vault });
    expect(res.output).toMatch(/rejected/i);
    expect(res.output).toMatch(/summary/i);
    expect(res.final_state).toBeUndefined();
    // Completion claim not accepted → loop stays active.
    expect(isAutoModeActive()).toBe(true);
  });

  test('termination_met with too-short summary is rejected', async () => {
    const { vault, slug } = await makeGoal('e10c');
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    const res = await dispatchExitAutoMode({ reason: 'termination_met', summary: 'done' }, { vault });
    expect(res.output).toMatch(/rejected/i);
    expect(isAutoModeActive()).toBe(true);
  });

  test('exit with summary writes executive-summary.md', async () => {
    const { vault, slug } = await makeGoal('e11');
    await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    const res = await dispatchExitAutoMode(
      { reason: 'manual', summary: 'Final verdict: X is strong buy.' },
      { vault },
    );
    expect(res.summary_path).toBeDefined();
    expect(res.output).toContain('Summary:');
    // Verify by re-reading plan
    const read = await dispatchResearchPlan(
      { action: 'read', goal_slug: slug },
      { vault },
    );
    expect(read.has_summary).toBe(true);
    expect(read.summary).toContain('strong buy');
  });

  test('generateAutoModeSessionId uniqueness', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateAutoModeSessionId());
    expect(ids.size).toBe(100);
  });

  test('Enter tool spec is well-formed', () => {
    const spec = buildEnterAutoModeTool();
    expect(spec.name).toBe('EnterAutoMode');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['goal_slug']);
  });

  test('Exit tool spec is well-formed', () => {
    const spec = buildExitAutoModeTool();
    expect(spec.name).toBe('ExitAutoMode');
    const params = spec.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { enum?: string[] }>;
    expect(props.reason?.enum).toContain('budget_tripped');
  });

  // ── AXON F2 — axonTermination wiring ──────────────────────────
  test('enter injects ## Axon Termination section into loop_prompt', async () => {
    const { vault, slug } = await makeGoal('f2-wiring');
    const res = await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(res.loop_prompt).toBeDefined();
    expect(res.loop_prompt).toContain('## Axon Termination (turn-level)');
    // The section body includes the 7-factor checklist header.
    expect(res.loop_prompt).toContain('Termination decision:');
    // Fresh goal: no questions → clarifying satisfied, no budget trip,
    // no goal termination → CONTINUE verdict.
    expect(res.loop_prompt).toContain('CONTINUE');
  });

  test('Axon Termination reflects budget state + goal-rule', async () => {
    const { vault, slug } = await makeGoal('f2-budget', { usd: 10 });
    // Do not trip the budget — expect the factor 6 note to say
    // "budget OK to continue".
    const res = await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
    expect(res.loop_prompt).toContain('budget OK to continue');
  });
});
