// ── PFC-S3 P5: loop-prompt snapshot + renderer ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLoopPromptSnapshot,
  renderLoopPromptInjection,
  type LoopPromptContext,
} from '../src/auto-research/loop-prompt';
import { BudgetMeter } from '../src/auto-research/budget-meter';
import { ExperimentLedger } from '../src/auto-research/experiment-ledger';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';

function scratchCtx(): LoopPromptContext {
  const dir = mkdtempSync(join(tmpdir(), 'loop-test-'));
  const goalRoot = join(dir, 'goals', 'sample');
  mkdirSync(join(goalRoot, 'knowledge'), { recursive: true });
  const vault: ObsidianVault = { root: dir, isSimulated: true, label: 't' };
  const ledger = new ExperimentLedger(goalRoot);
  const budget = new BudgetMeter({ tokens: 1000 });
  return {
    vault,
    goalSlug: 'sample',
    goalRoot,
    budget,
    ledger,
    termination: {
      kind: 'and',
      rules: [
        { kind: 'all_questions_answered', queuePath: 'question-queue.md' },
        { kind: 'summary_written', path: 'executive-summary.md', minChars: 100 },
      ],
    },
  };
}

describe('PFC-S3 P5 — buildLoopPromptSnapshot', () => {
  test('empty goal produces a valid snapshot', async () => {
    const ctx = scratchCtx();
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.plan).toBe('');
    expect(snap.queuePending.length).toBe(0);
    expect(snap.recentWins.length).toBe(0);
    expect(snap.nowNote).toBeNull();
    expect(snap.termination.shouldTerminate).toBe(false);   // summary missing
  });

  test('wires plan + queue + wins + NOW', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'plan.md'), '# Plan\n1. Spawn explorers\n');
    writeFileSync(join(ctx.goalRoot, 'question-queue.md'),
      `- [ ] investigate DRAM\n- [ ] sentiment\n- [x] done\n`);
    writeFileSync(join(ctx.goalRoot, 'knowledge', 'wins.md'),
      `- TrendForce DRAM is canonical\n- 외국인 net buy streak\n`);
    ctx.ledger.writeNow('last turn: decided to consult E6 contrarian');
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.plan).toContain('Spawn explorers');
    expect(snap.queuePending.length).toBe(2);
    expect(snap.recentWins.length).toBe(2);
    expect(snap.nowNote).toContain('contrarian');
  });

  test('truncates oversized plan', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'plan.md'), 'x'.repeat(5000));
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.plan.length).toBeLessThanOrEqual(2500);   // cap 2000 + suffix
    expect(snap.plan).toContain('[truncated]');
  });
});

describe('PFC-S3 P5 — renderLoopPromptInjection', () => {
  test('includes all 6 sections', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'plan.md'), 'sample plan');
    writeFileSync(join(ctx.goalRoot, 'question-queue.md'), `- [ ] q1\n`);
    const snap = await buildLoopPromptSnapshot(ctx);
    const text = renderLoopPromptInjection(snap);
    for (const section of ['Plan', 'Question Queue', 'Recent Wins', 'Budget', 'Completion Audit', 'NOW handoff']) {
      expect(text).toContain(section);
    }
  });

  test('completion audit: NOT-complete verdict blocks self-declared exit', async () => {
    const ctx = scratchCtx();
    // summary missing → shouldTerminate=false.
    const snap = await buildLoopPromptSnapshot(ctx);
    const text = renderLoopPromptInjection(snap);
    expect(snap.termination.shouldTerminate).toBe(false);
    expect(text).toContain('UNPROVEN');
    expect(text).toContain('NOT COMPLETE');
    expect(text).toContain('Do NOT');
    expect(text).toContain('unsatisfied');
  });

  test('completion audit: PASS verdict directs an evidenced ExitAutoMode', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'executive-summary.md'), 'x'.repeat(200));
    const snap = await buildLoopPromptSnapshot(ctx);
    const text = renderLoopPromptInjection(snap);
    expect(snap.termination.shouldTerminate).toBe(true);
    expect(text).toContain('OBJECTIVE CHECKS PASS');
    expect(text).toContain('termination_met');
    expect(text).toContain('summary');
  });

  test('pending queue items rendered as checkboxes (up to 10)', async () => {
    const ctx = scratchCtx();
    const lines = Array.from({ length: 15 }, (_, i) => `- [ ] q${i}`).join('\n');
    writeFileSync(join(ctx.goalRoot, 'question-queue.md'), lines);
    const snap = await buildLoopPromptSnapshot(ctx);
    const text = renderLoopPromptInjection(snap);
    expect((text.match(/^- \[ \]/gm) ?? []).length).toBe(10);
  });

  test('budget warning surfaced in render output', async () => {
    const ctx = scratchCtx();
    ctx.budget.add({ tokens: 950 });   // 95% → warning
    const snap = await buildLoopPromptSnapshot(ctx);
    const text = renderLoopPromptInjection(snap);
    expect(text).toContain('warning');
  });

  test('termination shouldTerminate reflects summary written', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'executive-summary.md'), 'x'.repeat(200));
    // queue empty → all_questions_answered OK; summary written → OK.
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.termination.shouldTerminate).toBe(true);
  });
});
