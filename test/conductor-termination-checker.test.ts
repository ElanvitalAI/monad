// ── §5-④ writer/checker separation ──

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withIndependentChecker,
  terminationPresetWithChecker,
} from '../src/conductor/termination-checker';
import {
  evaluateTermination,
  type TerminationRule,
  type TerminationContext,
} from '../src/auto-research/termination-dsl';

const ctx = (goalRoot: string): TerminationContext => ({
  vault: {} as never,
  budget: {} as never,
  goalRoot,
});

describe('withIndependentChecker', () => {
  test('wraps a single base rule in an AND with the checker', () => {
    const base: TerminationRule = { kind: 'summary_written', path: 'S.md' };
    const rule = withIndependentChecker(base, { command: 'true' });
    expect(rule.kind).toBe('and');
    if (rule.kind !== 'and') throw new Error('unreachable');
    expect(rule.rules).toHaveLength(2);
    expect(rule.rules[0]).toEqual(base);
    expect(rule.rules[1]).toMatchObject({ kind: 'custom', command: 'true' });
  });

  test('flattens an AND base (checker appended, tree stays shallow)', () => {
    const base: TerminationRule = {
      kind: 'and',
      rules: [
        { kind: 'summary_written', path: 'S.md' },
        { kind: 'min_sources', n: 3, sourcesPath: 'src.md' },
      ],
    };
    const rule = withIndependentChecker(base, { command: 'monad review --gate' });
    if (rule.kind !== 'and') throw new Error('unreachable');
    expect(rule.rules).toHaveLength(3); // 2 base + checker (no nesting)
    expect(rule.rules[2]).toMatchObject({ kind: 'custom', command: 'monad review --gate' });
  });

  test('checker gates completion even when the base is satisfied', async () => {
    // Base is trivially satisfiable (empty AND), but the checker fails →
    // the writer cannot self-declare done.
    const goalRoot = mkdtempSync(join(tmpdir(), 'checker-'));
    const base: TerminationRule = { kind: 'and', rules: [] }; // vacuously true
    const rejecting = withIndependentChecker(base, { command: 'exit 1', timeoutMs: 5000 });
    const outcome = await evaluateTermination(rejecting, ctx(goalRoot));
    expect(outcome.shouldTerminate).toBe(false); // checker refused

    const approving = withIndependentChecker(base, { command: 'exit 0', timeoutMs: 5000 });
    const ok = await evaluateTermination(approving, ctx(goalRoot));
    expect(ok.shouldTerminate).toBe(true); // base satisfied + checker approved
  });

  test('objective base + approving checker requires BOTH', async () => {
    const goalRoot = mkdtempSync(join(tmpdir(), 'checker2-'));
    const base: TerminationRule = { kind: 'summary_written', path: 'S.md', minChars: 5 };
    const rule = withIndependentChecker(base, { command: 'exit 0', timeoutMs: 5000 });
    // summary missing → not done even though checker approves.
    expect((await evaluateTermination(rule, ctx(goalRoot))).shouldTerminate).toBe(false);
    // write the artifact → now both hold → done.
    writeFileSync(join(goalRoot, 'S.md'), 'hello world');
    expect((await evaluateTermination(rule, ctx(goalRoot))).shouldTerminate).toBe(true);
  });

  test('terminationPresetWithChecker composes a preset + checker', () => {
    const rule = terminationPresetWithChecker('coding', { command: 'bun test' });
    if (rule.kind !== 'and') throw new Error('unreachable');
    const flat = JSON.stringify(rule);
    expect(flat).toContain('typecheck'); // coding preset content
    expect(rule.rules[rule.rules.length - 1]).toMatchObject({ kind: 'custom', command: 'bun test' });
  });
});
