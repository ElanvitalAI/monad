// ── PFC-S3 P4: termination DSL ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateTermination,
  type TerminationContext,
  type TerminationRule,
} from '../src/auto-research/termination-dsl';
import { BudgetMeter } from '../src/auto-research/budget-meter';

function scratchCtx(): TerminationContext & { goalRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), 'termination-test-'));
  return {
    vault: { root: dir, isSimulated: true, label: 't' },
    budget: new BudgetMeter({ tokens: 1000 }),
    goalRoot: dir,
  };
}

describe('PFC-S3 P4 — leaf rules', () => {
  test('all_questions_answered — empty queue (file absent)', async () => {
    const ctx = scratchCtx();
    const r = await evaluateTermination(
      { kind: 'all_questions_answered', queuePath: 'queue.md' },
      ctx,
    );
    expect(r.shouldTerminate).toBe(true);
  });

  test('all_questions_answered — pending checkbox remains', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'queue.md'), `- [ ] one\n- [x] done\n`);
    const r = await evaluateTermination(
      { kind: 'all_questions_answered', queuePath: 'queue.md' },
      ctx,
    );
    expect(r.shouldTerminate).toBe(false);
  });

  test('min_sources — enough URLs/bullets', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'sources.md'),
      `- https://a\n- https://b\n- https://c\n`);
    const r = await evaluateTermination(
      { kind: 'min_sources', n: 2, sourcesPath: 'sources.md' },
      ctx,
    );
    expect(r.shouldTerminate).toBe(true);
  });

  test('min_sources — file absent → false', async () => {
    const ctx = scratchCtx();
    const r = await evaluateTermination(
      { kind: 'min_sources', n: 1, sourcesPath: 'sources.md' },
      ctx,
    );
    expect(r.shouldTerminate).toBe(false);
  });

  test('summary_written — minChars gate', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'summary.md'), 'short');
    const r1 = await evaluateTermination(
      { kind: 'summary_written', path: 'summary.md', minChars: 100 },
      ctx,
    );
    expect(r1.shouldTerminate).toBe(false);
    writeFileSync(join(ctx.goalRoot, 'summary.md'), 'x'.repeat(200));
    const r2 = await evaluateTermination(
      { kind: 'summary_written', path: 'summary.md', minChars: 100 },
      ctx,
    );
    expect(r2.shouldTerminate).toBe(true);
  });

  test('budget_remaining_min — tripped when below ratio', async () => {
    const ctx = scratchCtx();
    ctx.budget.add({ tokens: 950 });   // 95% used → 5% remaining
    const r = await evaluateTermination(
      { kind: 'budget_remaining_min', ratio: 0.1 },
      ctx,
    );
    expect(r.shouldTerminate).toBe(false);   // below threshold
  });
});

describe('PFC-S3 P4 — composition', () => {
  test('and — every child must pass', async () => {
    const ctx = scratchCtx();
    writeFileSync(join(ctx.goalRoot, 'summary.md'), 'x'.repeat(200));
    const rule: TerminationRule = {
      kind: 'and',
      rules: [
        { kind: 'summary_written', path: 'summary.md', minChars: 100 },
        { kind: 'all_questions_answered', queuePath: 'queue.md' },   // absent → true
      ],
    };
    const r = await evaluateTermination(rule, ctx);
    expect(r.shouldTerminate).toBe(true);
  });

  test('or — any child passes', async () => {
    const ctx = scratchCtx();
    const rule: TerminationRule = {
      kind: 'or',
      rules: [
        { kind: 'summary_written', path: 'missing.md', minChars: 10 },
        { kind: 'all_questions_answered', queuePath: 'queue.md' },   // absent → true
      ],
    };
    const r = await evaluateTermination(rule, ctx);
    expect(r.shouldTerminate).toBe(true);
  });
});

describe('PFC-S3 P4 — custom shell evaluator', () => {
  test('exit 0 → true', async () => {
    const ctx = scratchCtx();
    const script = join(ctx.goalRoot, 'ok.sh');
    writeFileSync(script, `#!/bin/sh\nexit 0\n`);
    chmodSync(script, 0o755);
    const r = await evaluateTermination(
      { kind: 'custom', command: script, timeoutMs: 5_000 },
      ctx,
    );
    expect(r.shouldTerminate).toBe(true);
  });

  test('exit 1 → false + reason', async () => {
    const ctx = scratchCtx();
    const script = join(ctx.goalRoot, 'fail.sh');
    writeFileSync(script, `#!/bin/sh\necho "nope" >&2\nexit 1\n`);
    chmodSync(script, 0o755);
    const r = await evaluateTermination(
      { kind: 'custom', command: script, timeoutMs: 5_000 },
      ctx,
    );
    expect(r.shouldTerminate).toBe(false);
    expect(r.diagnostics.custom).toContain('exit 1');
  });
});
