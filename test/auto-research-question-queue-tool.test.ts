// ── PFC-S4 P2: QuestionQueue LLM tool ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchQuestionQueue,
  buildQuestionQueueTool,
} from '../src/auto-research/tools/question-queue';
import { dispatchResearchPlan } from '../src/auto-research/tools/research-plan';
import { discoverObsidianVault } from '../src/auto-research/obsidian-bridge';
import { resolveGoalPaths } from '../src/auto-research/goal-paths';

async function makeGoal(slug = 'q1') {
  const home = mkdtempSync(join(tmpdir(), 'qq-tool-'));
  const vault = discoverObsidianVault({
    env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
    cwd: home,
  });
  await dispatchResearchPlan({ action: 'init', goal_slug: slug, mission: 'test' }, { vault });
  return { vault, slug };
}

describe('PFC-S4 P2 — QuestionQueue tool', () => {
  test('list on empty queue returns zero counts + empty entries', async () => {
    const { vault, slug } = await makeGoal();
    const res = await dispatchQuestionQueue({ action: 'list', goal_slug: slug }, { vault });
    expect(res.entries).toEqual([]);
    expect(res.pending_count).toBe(0);
    expect(res.answered_count).toBe(0);
    expect(res.blocked_count).toBe(0);
  });

  test('add appends question with unanswered marker', async () => {
    const { vault, slug } = await makeGoal();
    const res = await dispatchQuestionQueue(
      { action: 'add', goal_slug: slug, text: 'What is the DRAM ASP trend?' },
      { vault },
    );
    expect(res.pending_count).toBe(1);
    expect(res.entries?.[0]?.text).toBe('What is the DRAM ASP trend?');
    expect(res.entries?.[0]?.mark).toBe('unanswered');
    expect(res.notices?.[0]).toContain('added at index 0');
  });

  test('add requires text', async () => {
    const { vault, slug } = await makeGoal();
    await expect(
      dispatchQuestionQueue({ action: 'add', goal_slug: slug } as any, { vault }),
    ).rejects.toThrow(/text is required/);
  });

  test('answer flips marker to x', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q2' }, { vault });
    const res = await dispatchQuestionQueue(
      { action: 'answer', goal_slug: slug, index: 0 },
      { vault },
    );
    expect(res.pending_count).toBe(1);
    expect(res.answered_count).toBe(1);
    const raw = readFileSync(resolveGoalPaths(vault, slug).queue, 'utf-8');
    expect(raw.includes('- [x] q1')).toBe(true);
    expect(raw.includes('- [ ] q2')).toBe(true);
  });

  test('block flips marker to !', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    const res = await dispatchQuestionQueue({ action: 'block', goal_slug: slug, index: 0 }, { vault });
    expect(res.blocked_count).toBe(1);
    expect(res.pending_count).toBe(0);
  });

  test('reopen flips x or ! back to space', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    await dispatchQuestionQueue({ action: 'answer', goal_slug: slug, index: 0 }, { vault });
    const res = await dispatchQuestionQueue({ action: 'reopen', goal_slug: slug, index: 0 }, { vault });
    expect(res.pending_count).toBe(1);
    expect(res.answered_count).toBe(0);
  });

  test('remove deletes entry + reindexes subsequent entries', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q2' }, { vault });
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q3' }, { vault });
    const res = await dispatchQuestionQueue({ action: 'remove', goal_slug: slug, index: 1 }, { vault });
    expect(res.pending_count).toBe(2);
    expect(res.entries?.map(e => e.text)).toEqual(['q1', 'q3']);
    expect(res.entries?.map(e => e.index)).toEqual([0, 1]);
  });

  test('list with filter returns only matching mark', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q2' }, { vault });
    await dispatchQuestionQueue({ action: 'answer', goal_slug: slug, index: 0 }, { vault });
    const res = await dispatchQuestionQueue(
      { action: 'list', goal_slug: slug, filter: 'answered' },
      { vault },
    );
    expect(res.entries?.length).toBe(1);
    expect(res.entries?.[0]?.text).toBe('q1');
    expect(res.pending_count).toBe(1);       // full counts even with filter
    expect(res.answered_count).toBe(1);
  });

  test('non-checkbox lines preserved verbatim', async () => {
    const { vault, slug } = await makeGoal();
    const paths = resolveGoalPaths(vault, slug);
    mkdirSync(paths.goalRoot, { recursive: true });
    writeFileSync(paths.queue, '## section\n- [ ] q1\n- [x] q2\nplain line\n', 'utf-8');
    const res = await dispatchQuestionQueue({ action: 'answer', goal_slug: slug, index: 0 }, { vault });
    const raw = readFileSync(paths.queue, 'utf-8');
    expect(raw).toContain('## section');
    expect(raw).toContain('- [x] q1');
    expect(raw).toContain('plain line');
    expect(res.pending_count).toBe(0);
    expect(res.answered_count).toBe(2);
  });

  test('answer out-of-range throws', async () => {
    const { vault, slug } = await makeGoal();
    await dispatchQuestionQueue({ action: 'add', goal_slug: slug, text: 'q1' }, { vault });
    await expect(
      dispatchQuestionQueue({ action: 'answer', goal_slug: slug, index: 5 }, { vault }),
    ).rejects.toThrow(/out of range/);
  });

  test('answer without index throws', async () => {
    const { vault, slug } = await makeGoal();
    await expect(
      dispatchQuestionQueue({ action: 'answer', goal_slug: slug } as any, { vault }),
    ).rejects.toThrow(/index .* required/);
  });

  test('auto-creates queue file if goal init skipped it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'qq-noinit-'));
    const vault = discoverObsidianVault({
      env: { MONAD_OBSIDIAN_VAULT: join(home, 'vault') },
      cwd: home,
    });
    // No init — but QuestionQueue should tolerantly create the queue file
    // (the surrounding dir still has to exist; skip dir check for simplicity).
    const paths = resolveGoalPaths(vault, 'noinit');
    mkdirSync(paths.goalRoot, { recursive: true });
    const res = await dispatchQuestionQueue(
      { action: 'add', goal_slug: 'noinit', text: 'bootstrapped' },
      { vault },
    );
    expect(res.pending_count).toBe(1);
  });

  test('LLM tool spec is well-formed', () => {
    const spec = buildQuestionQueueTool();
    expect(spec.name).toBe('QuestionQueue');
    const params = spec.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['action', 'goal_slug']);
  });
});
