// ── PFC-S4 P6: auto-research ToolRuntime registration ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALL_AUTO_RESEARCH_RUNTIMES,
  researchPlanRuntime,
  questionQueueRuntime,
  budgetRuntime,
  terminationCheckRuntime,
  enterAutoModeRuntime,
  exitAutoModeRuntime,
} from '../src/tool-runtime/auto-research-runtimes';
import {
  registerToolRuntime,
  getToolRuntime,
  dispatchToolByName,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/index';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { resetAutoModeForTest } from '../src/auto-research/auto-mode';

describe('PFC-S4 P6 — ToolRuntime registration', () => {
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    resetAutoModeForTest();
  });

  test('ALL_AUTO_RESEARCH_RUNTIMES has 6 members with unique ids', () => {
    expect(ALL_AUTO_RESEARCH_RUNTIMES.length).toBe(6);
    const ids = ALL_AUTO_RESEARCH_RUNTIMES.map(rt => rt.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual([
      'research_plan',
      'question_queue',
      'budget',
      'termination_check',
      'enter_auto_mode',
      'exit_auto_mode',
    ]);
  });

  test('each runtime exposes a tool spec with matching name', () => {
    expect(researchPlanRuntime.spec.name).toBe('ResearchPlan');
    expect(questionQueueRuntime.spec.name).toBe('QuestionQueue');
    expect(budgetRuntime.spec.name).toBe('Budget');
    expect(terminationCheckRuntime.spec.name).toBe('TerminationCheck');
    expect(enterAutoModeRuntime.spec.name).toBe('EnterAutoMode');
    expect(exitAutoModeRuntime.spec.name).toBe('ExitAutoMode');
  });

  test('registration is idempotent — duplicate register call does not throw', () => {
    for (const rt of ALL_AUTO_RESEARCH_RUNTIMES) registerToolRuntime(rt);
    // Register again
    for (const rt of ALL_AUTO_RESEARCH_RUNTIMES) registerToolRuntime(rt);
    expect(getToolRuntime('research_plan')).toBeDefined();
    expect(getToolRuntime('exit_auto_mode')).toBeDefined();
  });

  test('dispatchToolByName routes through registered runtime', async () => {
    for (const rt of ALL_AUTO_RESEARCH_RUNTIMES) registerToolRuntime(rt);
    const home = mkdtempSync(join(tmpdir(), 'rt-dispatch-'));
    const vault = discoverObsidianVault({
      env: { ELANOUS_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    process.env.ELANOUS_OBSIDIAN_VAULT = join(home, 'vault');
    try {
      // Initialise a goal so subsequent dispatches have something to read
      await dispatchResearchPlan(
        { action: 'init', goal_slug: 'rt-1', mission: 'rt test' },
        { vault },
      );
      const res = await dispatchToolByName(
        'research_plan',
        { action: 'read', goal_slug: 'rt-1' },
        { surface: 'skill' },
      );
      expect((res as any).mission).toBe('rt test');
    } finally {
      delete process.env.ELANOUS_OBSIDIAN_VAULT;
    }
  });

  test('dispatchToolByName unknown id throws', async () => {
    for (const rt of ALL_AUTO_RESEARCH_RUNTIMES) registerToolRuntime(rt);
    await expect(
      dispatchToolByName('not_a_real_tool', {}, { surface: 'skill' }),
    ).rejects.toThrow();
  });
});
