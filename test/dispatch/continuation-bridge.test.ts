// ── §5-③ Phase C1: continuation bridge ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverObsidianVault } from '../../src/auto-research/obsidian-bridge';
import { dispatchResearchPlan } from '../../src/auto-research/tools/research-plan';
import {
  dispatchEnterAutoMode,
  getAutoModeState,
  resetAutoModeForTest,
} from '../../src/auto-research/auto-mode';
import { resolveGoalPaths } from '../../src/auto-research/goal-paths';
import { buildContinuationDriverDeps } from '../../src/dispatch/continuation-bridge';
import { ContinuationDriver } from '../../src/dispatch/continuation-driver';

const TERM = { kind: 'summary_written', path: 'executive-summary.md', minChars: 50 } as const;

async function activeGoal(slug: string) {
  const home = mkdtempSync(join(tmpdir(), 'cont-bridge-'));
  const vault = discoverObsidianVault({
    env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  await dispatchResearchPlan(
    { action: 'init', goal_slug: slug, mission: 'test', termination: TERM },
    { vault },
  );
  await dispatchEnterAutoMode({ goal_slug: slug }, { vault });
  return { vault, slug, paths: resolveGoalPaths(vault, slug) };
}

describe('continuation bridge', () => {
  beforeEach(() => { resetAutoModeForTest(); });

  test('buildPrompt injects the completion-audit loop-prompt', async () => {
    const { vault, slug } = await activeGoal('b1');
    const deps = buildContinuationDriverDeps({
      goalSlug: slug,
      terminationRule: getAutoModeState().terminationRule!,
      runTurn: async () => ({ text: 'ok' }),
      vault,
    });
    const prompt = await deps.buildPrompt();
    expect(prompt).toContain('Completion Audit');
    expect(prompt).toContain('UNPROVEN');
  });

  test('isActive true only for the active goal slug', async () => {
    const { vault, slug } = await activeGoal('b2');
    const term = getAutoModeState().terminationRule!;
    const mine = buildContinuationDriverDeps({ goalSlug: slug, terminationRule: term, runTurn: async () => ({ text: '' }), vault });
    const other = buildContinuationDriverDeps({ goalSlug: 'someone-else', terminationRule: term, runTurn: async () => ({ text: '' }), vault });
    expect(mine.isActive()).toBe(true);
    expect(other.isActive()).toBe(false);
  });

  test('isTerminated flips when the objective condition is met', async () => {
    const { vault, slug, paths } = await activeGoal('b3');
    const deps = buildContinuationDriverDeps({
      goalSlug: slug,
      terminationRule: getAutoModeState().terminationRule!,
      runTurn: async () => ({ text: '' }),
      vault,
    });
    // isTerminated re-evaluates goal-state files (ignores the turn result).
    expect(await deps.isTerminated({ text: '' })).toBe(false); // no summary yet
    writeFileSync(join(paths.goalRoot, 'executive-summary.md'), 'x'.repeat(100));
    expect(await deps.isTerminated({ text: '' })).toBe(true); // summary written
  });

  test('passes the terminal lifecycle hook through to the driver', async () => {
    const { vault, slug, paths } = await activeGoal('b-halt');
    const halts: string[] = [];
    const deps = buildContinuationDriverDeps({
      goalSlug: slug,
      terminationRule: getAutoModeState().terminationRule!,
      runTurn: async () => {
        writeFileSync(join(paths.goalRoot, 'executive-summary.md'), 'y'.repeat(100));
        return { text: 'done' };
      },
      onHalt: (outcome) => { halts.push(outcome); },
      vault,
    });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('complete');
    expect(halts).toEqual(['complete']);
  });

  test('drives a ContinuationDriver end-to-end to completion', async () => {
    const { vault, slug, paths } = await activeGoal('b4');
    let turn = 0;
    const deps = buildContinuationDriverDeps({
      goalSlug: slug,
      terminationRule: getAutoModeState().terminationRule!,
      // the "agent" writes the summary on its 2nd turn → termination flips.
      runTurn: async () => {
        turn++;
        if (turn === 2) writeFileSync(join(paths.goalRoot, 'executive-summary.md'), 'y'.repeat(100));
        return { text: `turn ${turn}` };
      },
      vault,
    });
    const d = new ContinuationDriver(deps);
    expect((await d.step()).outcome).toBe('continued'); // turn 1 — no summary
    expect((await d.step()).outcome).toBe('complete');  // turn 2 wrote summary → terminated
    expect(d.turnCount).toBe(2);
  });
});
