import { describe, expect, test } from 'bun:test';
import { projectTaskToCard } from '../src/task-orchestrator/board/card.ts';
import { createTask, type Task, type TaskSurface } from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mk(overrides: Partial<Parameters<typeof createTask>[0]> = {}, now = 1000): Task {
  return createTask({ title: 't', surface: surfaceLlm, ...overrides }, { now });
}

describe('projectTaskToCard', () => {
  test('C1: ready task basic projection', () => {
    const t = mk({}, 1000);
    const c = projectTaskToCard(t, { now: 2000 });
    expect(c.id).toBe(t.id);
    expect(c.title).toBe('t');
    expect(c.status).toBe('backlog');
    expect(c.surfaceKind).toBe('llm-direct');
    expect(c.surfaceGlyph).toBeTruthy();
    expect(c.priority).toBe('medium');
    expect(c.progress).toBeUndefined();
    expect(c.ageMs).toBe(1000);
  });

  test('C2: running task → progress = attempt/maxRetries', () => {
    const t = mk({ maxRetries: 3 });
    t.attempt = 1;
    t.status = 'running';
    const c = projectTaskToCard(t);
    expect(c.progress).toBeCloseTo(1 / 3);
  });

  test('C3: retry badge when attempt>0', () => {
    const t = mk({ maxRetries: 2 });
    t.attempt = 1;
    const c = projectTaskToCard(t);
    const badge = c.badges.find((b) => b.kind === 'retry');
    expect(badge?.text).toBe('retry 1/2');
  });

  test('C4: goalSlug badge', () => {
    const t = mk({ goalSlug: 'ship-it' });
    const c = projectTaskToCard(t);
    expect(c.goalSlug).toBe('ship-it');
    expect(c.badges.some((b) => b.kind === 'goal' && b.text === 'ship-it')).toBe(true);
  });

  test('C5: feature badge when featureName', () => {
    const t = mk({ featureName: 'auth' });
    const c = projectTaskToCard(t);
    expect(c.badges.some((b) => b.kind === 'feature' && b.text === 'auth')).toBe(true);
  });

  test('C6: hasAcceptance when checks present', () => {
    const t = mk({
      acceptance: { criteria: [], checks: [{ kind: 'exit-code', expected: 0 }] },
    });
    const c = projectTaskToCard(t);
    expect(c.hasAcceptance).toBe(true);
  });

  test('C7: title truncation with ellipsis', () => {
    const long = 'x'.repeat(60);
    const t = mk({ title: long });
    const c = projectTaskToCard(t, { titleMaxLen: 20 });
    expect(c.title.length).toBe(20);
    expect(c.title.endsWith('…')).toBe(true);
  });

  test('C8: ageMs non-negative even when now < createdAt', () => {
    const t = mk({}, 5000);
    const c = projectTaskToCard(t, { now: 4000 });
    expect(c.ageMs).toBe(0);
  });

  test('C9: generatedBy llm → generated badge', () => {
    const t = mk({ generatedBy: { kind: 'llm', modelId: 'x' } });
    const c = projectTaskToCard(t);
    expect(c.badges.some((b) => b.kind === 'generated')).toBe(true);
  });

  test('C10: estimate badge formatted as $0.12', () => {
    const t = mk({ estimateUsd: 0.123 });
    const c = projectTaskToCard(t);
    expect(c.badges.find((b) => b.kind === 'estimate')?.text).toBe('$0.12');
  });
});
