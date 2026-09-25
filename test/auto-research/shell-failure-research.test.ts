// ── T1 (Phase 1) — shell-failure-research tests ──

import { describe, expect, test } from 'bun:test';
import {
  classifyShellFailure,
  researchShellFailure,
  type ShellFailureProposer,
} from '../../src/auto-research/shell-failure-research';
import type { ShellResult } from '../../src/shell-runner/types';

function result(opts: {
  exitCode?: number;
  text?: string;
  outcome?: ShellResult['outcome'];
  timedOut?: boolean;
  interrupted?: boolean;
}): ShellResult {
  return {
    exitCode: opts.exitCode,
    stdout: { text: '' },
    stderr: { text: '' },
    aggregated: { text: opts.text ?? '' },
    durationMs: 100,
    timedOut: opts.timedOut ?? false,
    interrupted: opts.interrupted ?? false,
    truncated: false,
    outcome: opts.outcome ?? 'exit',
  };
}

describe('classifyShellFailure', () => {
  test('null → unknown', () => {
    const c = classifyShellFailure(null);
    expect(c.clazz).toBe('unknown');
  });

  test('exit 0 → success', () => {
    expect(classifyShellFailure(result({ exitCode: 0 })).clazz).toBe('success');
  });

  test('exit undefined → success (no signal)', () => {
    expect(classifyShellFailure(result({})).clazz).toBe('success');
  });

  test('exit 1 + AssertionError text → error-with-trace', () => {
    const c = classifyShellFailure(result({
      exitCode: 1,
      text: 'AssertionError: expected 5 got 3',
    }));
    expect(c.clazz).toBe('error-with-trace');
    expect(c.errorMarker).toBe('AssertionError');
  });

  test('exit 1 + Traceback → error-with-trace', () => {
    const c = classifyShellFailure(result({
      exitCode: 1,
      text: 'Traceback (most recent call last):\n  File ...',
    }));
    expect(c.clazz).toBe('error-with-trace');
    expect(c.errorMarker).toBe('Traceback');
  });

  test('exit 1 + permission denied → error-with-trace', () => {
    const c = classifyShellFailure(result({
      exitCode: 1,
      text: 'cat: /etc/shadow: Permission denied',
    }));
    expect(c.clazz).toBe('error-with-trace');
    expect(c.errorMarker).toBe('permission');
  });

  test('exit 1 + clean output (grep no-match) → silent-nonzero', () => {
    const c = classifyShellFailure(result({ exitCode: 1, text: '' }));
    expect(c.clazz).toBe('silent-nonzero');
  });

  test('outcome=timeout → timeout', () => {
    expect(classifyShellFailure(result({
      exitCode: undefined,
      outcome: 'timeout',
      timedOut: true,
    })).clazz).toBe('timeout');
  });

  test('interrupted → killed', () => {
    expect(classifyShellFailure(result({
      exitCode: 130,
      interrupted: true,
    })).clazz).toBe('killed');
  });

  test('outcome=aborted → killed', () => {
    expect(classifyShellFailure(result({
      exitCode: undefined,
      outcome: 'aborted',
    })).clazz).toBe('killed');
  });

  test('tail keeps last 20 lines', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const c = classifyShellFailure(result({ exitCode: 1, text: lines.join('\n') }));
    expect(c.tail.split('\n')).toHaveLength(20);
    expect(c.tail.split('\n')[0]).toBe('line 20');
  });
});

describe('researchShellFailure', () => {
  test('success → no candidates', async () => {
    const r = await researchShellFailure({
      handle: null,
      result: result({ exitCode: 0 }),
    });
    expect(r.candidates).toHaveLength(0);
    expect(r.classification.clazz).toBe('success');
  });

  test('error-with-trace → heuristic candidate', async () => {
    const r = await researchShellFailure({
      handle: null,
      result: result({ exitCode: 1, text: 'AssertionError: foo' }),
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.source).toBe('heuristic');
    expect(r.candidates[0]!.label).toContain('AssertionError');
  });

  test('LLM proposer adds candidates after heuristic', async () => {
    const llm: ShellFailureProposer = async () => [{
      label: 'try setting timezone=UTC',
      source: 'llm',
      suggestion: 'export TZ=UTC',
    }];

    const r = await researchShellFailure(
      { handle: null, result: result({ exitCode: 1, text: 'AssertionError: foo' }) },
      { llmProposer: llm },
    );

    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]!.source).toBe('heuristic');
    expect(r.candidates[1]!.source).toBe('llm');
  });

  test('proposer that throws is isolated', async () => {
    const broken: ShellFailureProposer = async () => {
      throw new Error('llm down');
    };
    const r = await researchShellFailure(
      { handle: null, result: result({ exitCode: 1, text: 'Error: foo' }) },
      { llmProposer: broken },
    );
    expect(r.candidates).toHaveLength(1); // heuristic only.
  });

  test('proposer past budget is dropped', async () => {
    const slow: ShellFailureProposer = () => new Promise((resolve) => {
      setTimeout(() => resolve([{ label: 'too late', source: 'llm' }]), 200);
    });
    const r = await researchShellFailure(
      { handle: null, result: result({ exitCode: 1, text: 'Error: foo' }) },
      { llmProposer: slow, budgetMs: 50 },
    );
    expect(r.candidates).toHaveLength(1); // heuristic only — slow proposer dropped.
  });

  test('elapsedMs reported', async () => {
    const r = await researchShellFailure(
      { handle: null, result: result({ exitCode: 1, text: 'Error: foo' }) },
    );
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
