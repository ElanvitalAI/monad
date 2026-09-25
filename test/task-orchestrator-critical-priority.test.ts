import { describe, expect, test } from 'bun:test';
import { createTask, type TaskSurface } from '../src/task-orchestrator/types.ts';

const surface: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

describe('createTask critical-priority enforcement (TOX-6 FU-2)', () => {
  test('C1: urgent + no checks/criteria → throws', () => {
    expect(() =>
      createTask({ title: 'urgent no gate', surface, priority: 'urgent' }),
    ).toThrow(/urgent/);
  });

  test('C2: urgent + at least one check → OK', () => {
    expect(() =>
      createTask({
        title: 'urgent with check',
        surface,
        priority: 'urgent',
        acceptance: { criteria: [], checks: [{ kind: 'exit-code', expected: 0 }] },
      }),
    ).not.toThrow();
  });

  test('C3: urgent + at least one criterion → OK', () => {
    expect(() =>
      createTask({
        title: 'urgent with criterion',
        surface,
        priority: 'urgent',
        acceptance: { criteria: ['verify result'], checks: [] },
      }),
    ).not.toThrow();
  });

  test('C4: urgent + allowUncheckedUrgent → OK + WARN note', () => {
    const t = createTask(
      { title: 'urgent override', surface, priority: 'urgent' },
      { allowUncheckedUrgent: true },
    );
    expect(t.priority).toBe('urgent');
    expect(t.notes.some((n) => n.startsWith('[WARN]'))).toBe(true);
  });

  test('C5: non-urgent + no acceptance → OK (existing behaviour)', () => {
    const t = createTask({ title: 'regular', surface, priority: 'high' });
    expect(t.priority).toBe('high');
    expect(t.notes).toEqual([]);
  });

  test('C6: urgent with empty checks AND empty criteria → throws', () => {
    expect(() =>
      createTask({
        title: 'urgent empty accept',
        surface,
        priority: 'urgent',
        acceptance: { criteria: [], checks: [] },
      }),
    ).toThrow(/urgent/);
  });
});
