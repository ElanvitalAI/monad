import { describe, expect, test } from 'bun:test';
import {
  evaluateAcceptance,
  type AcceptanceIo,
} from '../src/task-orchestrator/acceptance.ts';
import {
  createTask,
  createExecution,
  type Task,
  type TaskExecution,
  type TaskSurface,
  type TaskDeterministicCheck,
} from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mkTask(checks: TaskDeterministicCheck[]): Task {
  return createTask({
    title: 'x',
    surface: surfaceLlm,
    acceptance: { criteria: [], checks },
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

describe('evaluateAcceptance', () => {
  test('A1: empty checks → allPass true', async () => {
    const t = createTask({ title: 't', surface: surfaceLlm });
    const exec = mkExec(t);
    const r = await evaluateAcceptance({ task: t, exec });
    expect(r.allPass).toBe(true);
    expect(r.total).toBe(0);
  });

  test('A2: exit-code 0 matches completed', async () => {
    const t = mkTask([{ kind: 'exit-code', expected: 0 }]);
    const exec = mkExec(t);
    const r = await evaluateAcceptance({ task: t, exec });
    expect(r.allPass).toBe(true);
  });

  test('A3: exit-code mismatch → failed', async () => {
    const t = mkTask([{ kind: 'exit-code', expected: 0 }]);
    const exec = mkExec(t, {
      status: 'failed',
      error: { code: 'EXIT_3', message: 'bad' },
    });
    const r = await evaluateAcceptance({ task: t, exec });
    expect(r.allPass).toBe(false);
    expect(r.failed[0]!.reason).toMatch(/exit-code 3 != 0/);
  });

  test('A4: file-exists hit', async () => {
    const t = mkTask([{ kind: 'file-exists', path: '/tmp/out.log' }]);
    const exec = mkExec(t);
    const io: AcceptanceIo = { existsSync: (p) => p === '/tmp/out.log' };
    const r = await evaluateAcceptance({ task: t, exec, io });
    expect(r.allPass).toBe(true);
  });

  test('A5: file-exists miss', async () => {
    const t = mkTask([{ kind: 'file-exists', path: '/nope' }]);
    const r = await evaluateAcceptance({
      task: t,
      exec: mkExec(t),
      io: { existsSync: () => false },
    });
    expect(r.allPass).toBe(false);
  });

  test('A6: file-contains plain string', async () => {
    const t = mkTask([{ kind: 'file-contains', path: '/x.log', pattern: 'hello' }]);
    const io: AcceptanceIo = {
      existsSync: () => true,
      readFileSync: () => 'world\nhello kitty\n',
    };
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(true);
  });

  test('A7: file-contains regex (pattern has metachars)', async () => {
    const t = mkTask([{ kind: 'file-contains', path: '/x.log', pattern: 'hello\\s+kitty' }]);
    const io: AcceptanceIo = {
      existsSync: () => true,
      readFileSync: () => 'world\nhello kitty\n',
    };
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(true);
  });

  test('A8: output-matches regex hit', async () => {
    const t = mkTask([{ kind: 'output-matches', pattern: '^tests\\s+pass' }]);
    const exec = mkExec(t, { output: 'tests passed in 0.3s' });
    const r = await evaluateAcceptance({ task: t, exec });
    expect(r.allPass).toBe(true);
  });

  test('A9: output-matches miss', async () => {
    const t = mkTask([{ kind: 'output-matches', pattern: 'ERROR' }]);
    const exec = mkExec(t, { output: 'ok\nall good' });
    const r = await evaluateAcceptance({ task: t, exec });
    expect(r.allPass).toBe(false);
  });

  test('A10: shell-zero pass', async () => {
    const t = mkTask([{ kind: 'shell-zero', command: 'tsc --noEmit' }]);
    const io: AcceptanceIo = {
      spawnZero: async () => ({ exitCode: 0 }),
    };
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(true);
  });

  test('A11: shell-zero non-zero', async () => {
    const t = mkTask([{ kind: 'shell-zero', command: 'bad' }]);
    const io: AcceptanceIo = {
      spawnZero: async () => ({ exitCode: 2 }),
    };
    const r = await evaluateAcceptance({ task: t, exec: mkExec(t), io });
    expect(r.allPass).toBe(false);
  });

  test('A12: mixed — partial fail surfaces in failed list', async () => {
    const t = mkTask([
      { kind: 'exit-code', expected: 0 },
      { kind: 'file-exists', path: '/missing' },
    ]);
    const exec = mkExec(t);
    const io: AcceptanceIo = { existsSync: () => false };
    const r = await evaluateAcceptance({ task: t, exec, io });
    expect(r.allPass).toBe(false);
    expect(r.passed).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
    expect(r.total).toBe(2);
  });
});
