// ── §5-① goalKind Termination presets ──

import { describe, expect, test } from 'bun:test';
import { terminationPresetFor } from '../src/conductor/termination-presets';
import { GOAL_KINDS, type GoalKind } from '../src/conductor/types';
import { evaluateTermination, type TerminationRule } from '../src/auto-research/termination-dsl';

// Structural guard: a rule tree only uses known kinds and required fields.
function assertWellFormed(rule: TerminationRule): void {
  const KINDS = new Set([
    'all_questions_answered', 'min_sources', 'summary_written',
    'budget_remaining_min', 'and', 'or', 'custom',
  ]);
  expect(KINDS.has(rule.kind)).toBe(true);
  switch (rule.kind) {
    case 'and':
    case 'or':
      expect(Array.isArray(rule.rules)).toBe(true);
      rule.rules.forEach(assertWellFormed);
      break;
    case 'custom':
      expect(typeof rule.command).toBe('string');
      expect(rule.command.length).toBeGreaterThan(0);
      break;
    case 'min_sources':
      expect(typeof rule.n).toBe('number');
      expect(typeof rule.sourcesPath).toBe('string');
      break;
    case 'summary_written':
      expect(typeof rule.path).toBe('string');
      break;
  }
}

describe('terminationPresetFor', () => {
  test('every GoalKind returns a well-formed rule', () => {
    for (const kind of GOAL_KINDS) {
      assertWellFormed(terminationPresetFor(kind));
    }
  });

  test('coding preset gates on tests + typecheck + PR note', () => {
    const rule = terminationPresetFor('coding');
    expect(rule.kind).toBe('and');
    const flat = JSON.stringify(rule);
    expect(flat).toContain('bun test');
    expect(flat).toContain('typecheck');
    expect(flat).toContain('PR.md');
  });

  test('research preset requires sources + summary', () => {
    const rule = terminationPresetFor('research');
    const flat = JSON.stringify(rule);
    expect(flat).toContain('min_sources');
    expect(flat).toContain('summary_written');
  });

  test('unknown kind falls back conservatively (not vacuously true)', () => {
    // Force the default branch — a value outside the closed union.
    const rule = terminationPresetFor('nonsense' as GoalKind);
    expect(rule.kind).not.toBe('and'); // not an empty `and` that would auto-satisfy
    expect(rule).toEqual({ kind: 'summary_written', path: 'DONE.md', minChars: 1 });
  });

  test('presets are evaluable by the Termination DSL (no crash)', async () => {
    // A goalRoot with no artifacts → nothing satisfied, but evaluation must
    // succeed and report shouldTerminate=false (proves rules are valid shape).
    const rule = terminationPresetFor('research');
    const outcome = await evaluateTermination(rule, {
      vault: {} as never,
      budget: {} as never,
      goalRoot: '/tmp/loop-runner-nonexistent-goalroot',
    });
    expect(typeof outcome.shouldTerminate).toBe('boolean');
    expect(outcome.shouldTerminate).toBe(false);
  });
});
