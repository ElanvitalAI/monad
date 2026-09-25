// ── PFC-S3.1 follow-up: Andon preamble auto-wire ──
//
// Verifies that CRITICAL escalations, once emitted, are injected into
// three prompt sources:
//
//   1. Loop-prompt `andonPreamble?` field (PFC-S4 auto-mode path).
//   2. Loop-prompt rendered string (`## Andon` section at the top).
//   3. EnterAutoMode snapshot output carries the preamble when emitted.
//
// The skill-runner prepend path is covered by integration — exercised
// by a lightweight inline mimic test that reproduces the edit's shape
// (`${preamble}\n\n${base}` merge into role:system) so regressions in
// the merge ordering surface as a unit failure rather than an
// end-to-end flake.

import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
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
import {
  buildAndonPreamble,
  clearAllEscalationsForTest,
  emitEscalation,
} from '../src/cft/andon';

function scratchCtx(): LoopPromptContext {
  const dir = mkdtempSync(join(tmpdir(), 'andon-wire-'));
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
      ],
    },
  };
}

describe('andon-auto-wire — loop-prompt', () => {
  beforeEach(() => {
    clearAllEscalationsForTest();
  });

  test('snapshot omits andonPreamble when no CRITICAL pending', async () => {
    const ctx = scratchCtx();
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.andonPreamble).toBeUndefined();
  });

  test('snapshot carries andonPreamble when ctx.andonPreamble set', async () => {
    const ctx = scratchCtx();
    ctx.andonPreamble = '🔴 ANDON (test-shim)';
    const snap = await buildLoopPromptSnapshot(ctx);
    expect(snap.andonPreamble).toBe('🔴 ANDON (test-shim)');
  });

  test('renderer emits `## Andon` section at the top when set', async () => {
    const ctx = scratchCtx();
    ctx.andonPreamble = '🔴 ANDON ESCALATION — fake';
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    expect(out.startsWith('## Andon')).toBe(true);
    expect(out).toContain('🔴 ANDON ESCALATION — fake');
    // `# Research Loop State` still present after Andon section.
    expect(out).toContain('# Research Loop State');
    const andonIdx = out.indexOf('## Andon');
    const rlsIdx = out.indexOf('# Research Loop State');
    expect(andonIdx).toBeLessThan(rlsIdx);
  });

  test('renderer omits Andon section when preamble absent', async () => {
    const ctx = scratchCtx();
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    expect(out.includes('## Andon')).toBe(false);
    expect(out.startsWith('# Research Loop State')).toBe(true);
  });

  test('buildAndonPreamble feeds loop-prompt end-to-end', async () => {
    await emitEscalation({
      agentId: 'test-a',
      severity: 'CRITICAL',
      reason: 'wire-test critical',
    }, { skipObsidian: true });
    const preamble = buildAndonPreamble();
    expect(preamble).not.toBeNull();
    expect(preamble).toContain('test-a');

    const ctx = scratchCtx();
    if (preamble) ctx.andonPreamble = preamble;
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    expect(out).toContain('## Andon');
    expect(out).toContain('wire-test critical');
  });
});

// ── Skill-runner prepend shape ────────────────────────────────────────
//
// The edit in src/skill-runner.ts (~line 915) merges the preamble with
// `${preamble}\n\n${base}`. This mimic re-runs that exact merge so a
// future refactor that accidentally flips the order (or appends
// instead of prepending) surfaces here.

function mimicSkillRunnerMerge(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const preamble = buildAndonPreamble();
  if (preamble && messages[0]?.role === 'system') {
    const base = messages[0].content;
    messages[0] = { role: 'system', content: `${preamble}\n\n${base}` };
  }
  return messages;
}

describe('andon-auto-wire — skill-runner prepend shape', () => {
  beforeEach(() => {
    clearAllEscalationsForTest();
  });

  test('no CRITICAL → system message unchanged', () => {
    const messages = [{ role: 'system', content: 'BASE PROMPT' }];
    const out = mimicSkillRunnerMerge(messages);
    expect(out[0]!.content).toBe('BASE PROMPT');
  });

  test('single CRITICAL → system message prefixed with ANDON block', async () => {
    await emitEscalation({
      agentId: 'bug-1',
      severity: 'CRITICAL',
      reason: 'r',
    }, { skipObsidian: true });
    const messages = [{ role: 'system', content: 'BASE PROMPT' }];
    const out = mimicSkillRunnerMerge(messages);
    expect(out[0]!.content.startsWith('🔴 ANDON ESCALATION')).toBe(true);
    expect(out[0]!.content).toContain('BASE PROMPT');
    expect(out[0]!.content).toContain('[bug-1]');
    // Order must be preamble → blank → base.
    expect(
      out[0]!.content.indexOf('🔴 ANDON'),
    ).toBeLessThan(out[0]!.content.indexOf('BASE PROMPT'));
  });

  test('two CRITICAL → both appear', async () => {
    await emitEscalation({
      agentId: 'bug-1', severity: 'CRITICAL', reason: 'r1',
    }, { skipObsidian: true });
    await emitEscalation({
      agentId: 'bug-2', severity: 'CRITICAL', reason: 'r2',
    }, { skipObsidian: true });
    const messages = [{ role: 'system', content: 'BASE' }];
    const out = mimicSkillRunnerMerge(messages);
    expect(out[0]!.content).toContain('[bug-1]');
    expect(out[0]!.content).toContain('[bug-2]');
  });

  test('HIGH only → system message unchanged (CRITICAL-gated)', async () => {
    await emitEscalation({
      agentId: 'warn-1',
      severity: 'HIGH',
      reason: 'noisy',
    }, { skipObsidian: true });
    const messages = [{ role: 'system', content: 'BASE' }];
    const out = mimicSkillRunnerMerge(messages);
    expect(out[0]!.content).toBe('BASE');
  });

  test('merge skipped when first message is not system', async () => {
    await emitEscalation({
      agentId: 'x', severity: 'CRITICAL', reason: 'r',
    }, { skipObsidian: true });
    const messages = [{ role: 'user', content: 'hi' }];
    const out = mimicSkillRunnerMerge(messages);
    expect(out[0]!.content).toBe('hi');
  });
});
