import { describe, expect, test } from 'bun:test';
import {
  evaluateAcceptance,
  type AcceptanceIo,
} from '../src/task-orchestrator/acceptance.ts';
import {
  createTask,
  createExecution,
  type Task,
  type TaskSurface,
  type TaskExecution,
  type TaskDeterministicCheck,
} from '../src/task-orchestrator/types.ts';

const surface: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mkTask(criteria: string[], checks: TaskDeterministicCheck[] = []): Task {
  return createTask({
    title: 't',
    surface,
    acceptance: { criteria, checks },
  });
}

function mkExec(task: Task, overrides: Partial<TaskExecution> = {}): TaskExecution {
  const base = createExecution(task);
  return {
    ...base,
    endedAt: base.startedAt,
    durationMs: 0,
    status: 'completed',
    ...overrides,
  };
}

describe('evaluateAcceptance LLM-review (TOX-6 FU-2)', () => {
  test('L1: criteria only + llmJudge → evaluated', async () => {
    let called = 0;
    const io: AcceptanceIo = {
      llmJudge: async () => {
        called++;
        return { passed: true, reason: 'looks right' };
      },
    };
    const t = mkTask(['output contains a JSON result']);
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(called).toBe(1);
    expect(r.allPass).toBe(true);
    expect(r.passed[0]!.check.kind).toBe('llm-review');
  });

  test('L2: checks + criteria both → checks first, then criteria', async () => {
    const calls: string[] = [];
    const io: AcceptanceIo = {
      llmJudge: async ({ criterion }) => {
        calls.push(`llm:${criterion}`);
        return { passed: true, reason: 'ok' };
      },
    };
    const t = mkTask(
      ['criterion A', 'criterion B'],
      [{ kind: 'output-matches', pattern: 'hello' }],
    );
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t, { output: 'hello' }), io });
    // First result must be the deterministic check
    expect(r.passed[0]!.check.kind).toBe('output-matches');
    // LLM calls come after
    expect(calls).toEqual(['llm:criterion A', 'llm:criterion B']);
  });

  test('L3: criteria without llmJudge → skipped (no-op pass)', async () => {
    const t = mkTask(['unchecked criterion']);
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t) });
    expect(r.allPass).toBe(true);
    expect(r.total).toBe(0); // criteria skipped, no checks either
  });

  test('L4: llmJudge returns passed=false → allPass=false', async () => {
    const io: AcceptanceIo = {
      llmJudge: async () => ({ passed: false, reason: 'output lacks result field' }),
    };
    const t = mkTask(['output contains result']);
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(false);
    expect(r.failed[0]!.reason).toContain('result field');
  });

  test('L5: llmJudge throws → report.failed with error reason', async () => {
    const io: AcceptanceIo = {
      llmJudge: async () => {
        throw new Error('LLM timed out');
      },
    };
    const t = mkTask(['criterion x']);
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(false);
    expect(r.failed[0]!.reason).toContain('threw');
    expect(r.failed[0]!.reason).toContain('timed out');
  });

  test('L6: multiple criteria evaluated in order', async () => {
    const order: string[] = [];
    const io: AcceptanceIo = {
      llmJudge: async ({ criterion }) => {
        order.push(criterion);
        return { passed: true, reason: 'ok' };
      },
    };
    const t = mkTask(['first', 'second', 'third']);
    await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('L7: llm-review CheckResult.check.kind is llm-review', async () => {
    const io: AcceptanceIo = {
      llmJudge: async () => ({ passed: true, reason: 'yes' }),
    };
    const t = mkTask(['c']);
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.passed[0]!.check.kind).toBe('llm-review');
    if (r.passed[0]!.check.kind === 'llm-review') {
      expect(r.passed[0]!.check.criterion).toBe('c');
    }
  });

  test('L8: empty criteria array → llmJudge not called', async () => {
    let called = 0;
    const io: AcceptanceIo = {
      llmJudge: async () => {
        called++;
        return { passed: true, reason: '' };
      },
    };
    const t = mkTask([]); // empty criteria, no checks either
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(called).toBe(0);
    expect(r.allPass).toBe(true);
  });
});
