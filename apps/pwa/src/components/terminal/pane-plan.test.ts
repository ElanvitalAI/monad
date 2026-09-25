import { describe, expect, test } from 'bun:test';

import type { DaemonTerminalSummary } from '@/lib/daemon-client';
import { panePlan, type PanePlan } from './pane-plan';

const row = (
  id: string,
  overrides: Partial<DaemonTerminalSummary> = {},
): DaemonTerminalSummary => ({
  id,
  alive: true,
  correlationId: `correlation-${id}`,
  instance: 'test',
  sessionId: `session-${id}`,
  startedAt: 1,
  accessMode: null,
  ...overrides,
});

describe('panePlan', () => {
  test('keeps rows without a run value as relationship-unavailable', () => {
    const plan: PanePlan = panePlan([row('parent'), row('possible-child', { startedAt: 20 })]);

    expect(plan).toEqual({
      layouts: [],
      unknown: [
        { id: 'parent', reason: 'relationship-unavailable' },
        { id: 'possible-child', reason: 'relationship-unavailable' },
      ],
    });
  });

  test('preserves alive, dead, nested-looking, and separate rows without claiming a split', () => {
    const plan = panePlan([
      row('root'),
      row('middle', { alive: false, startedAt: 10 }),
      row('leaf', { startedAt: 30 }),
      row('other-root'),
      row('other-child', { startedAt: 20 }),
    ]);

    expect(plan.layouts).toEqual([]);
    expect(plan.unknown).toEqual([
      { id: 'root', reason: 'relationship-unavailable' },
      { id: 'middle', reason: 'relationship-unavailable' },
      { id: 'leaf', reason: 'relationship-unavailable' },
      { id: 'other-root', reason: 'relationship-unavailable' },
      { id: 'other-child', reason: 'relationship-unavailable' },
    ]);
  });

  test('does not invent an input-order tie-breaker for equally recent run members', () => {
    const plan = panePlan([
      row('first', { runId: 'run-a', startedAt: 10 }),
      row('second', { runId: 'run-a', startedAt: 10 }),
      row('invalid', { runId: 'run-a', startedAt: Number.NaN }),
    ]);

    expect(plan.layouts).toEqual([]);
    expect(plan.unknown.map(({ id }) => id)).toEqual(['first', 'second', 'invalid']);
  });

  test('is deterministic, handles empty input, and survives a JSON round trip', () => {
    const input = [row('one'), row('one'), row('two', { alive: false })];
    const once = panePlan(input);

    expect(panePlan(input)).toEqual(once);
    expect(panePlan([])).toEqual({ layouts: [], unknown: [] });
    expect(JSON.parse(JSON.stringify(once))).toEqual(once);
  });

  test('splits the uniquely newest live run member and tabs the remaining run members', () => {
    const plan = panePlan([
      row('older-live', { runId: 'run-a', startedAt: 10 }),
      row('dead-newest', { alive: false, runId: 'run-a', startedAt: 30 }),
      row('newest-live', { runId: 'run-a', startedAt: 20 }),
      row('other-run', { runId: 'run-b', startedAt: 40 }),
    ]);

    expect(plan).toEqual({
      layouts: [
        { runId: 'run-a', split: 'newest-live', tabs: ['older-live', 'dead-newest'] },
        { runId: 'run-b', split: 'other-run', tabs: [] },
      ],
      unknown: [],
    });
  });

  test('keeps all members unknown when every run member is dead or tied for newest', () => {
    const plan = panePlan([
      row('dead-first', { alive: false, runId: 'dead-run', startedAt: 10 }),
      row('dead-second', { alive: false, runId: 'dead-run', startedAt: 30 }),
      row('tied-first', { runId: 'tied-run', startedAt: 20 }),
      row('tied-second', { runId: 'tied-run', startedAt: 20 }),
    ]);

    expect(plan.layouts).toEqual([]);
    expect(plan.unknown.map(({ id }) => id)).toEqual([
      'dead-first',
      'dead-second',
      'tied-first',
      'tied-second',
    ]);
  });

  test('keeps blank run rows unknown and ignores parent metadata', () => {
    const plan = panePlan([
      row('first', { runId: 'run-a', startedAt: 10, parentPtyId: '' }),
      row('second', { runId: 'run-a', startedAt: 20, parentPtyId: '' }),
      row('blank-run', { runId: '   ', parentPtyId: 'unrelated-parent' }),
    ]);

    expect(plan).toEqual({
      layouts: [{ runId: 'run-a', split: 'second', tabs: ['first'] }],
      unknown: [{ id: 'blank-run', reason: 'relationship-unavailable' }],
    });
    expect(plan.layouts[0]).not.toHaveProperty('parentId');
  });

  test('is deterministic and JSON-serializable for run plans', () => {
    const input = [
      row('old', { runId: 'run-a', startedAt: 10 }),
      row('new', { runId: 'run-a', startedAt: 20 }),
      row('unrelated'),
    ];
    const once = panePlan(input);

    expect(panePlan(input)).toEqual(once);
    expect(JSON.parse(JSON.stringify(once))).toEqual(once);
  });

  test('does not merge rows from different runs', () => {
    const plan = panePlan([
      row('run-a-row', { runId: 'run-a', startedAt: 10 }),
      row('run-b-row', { runId: 'run-b', startedAt: 20 }),
    ]);

    expect(plan.layouts).toEqual([
      { runId: 'run-a', split: 'run-a-row', tabs: [] },
      { runId: 'run-b', split: 'run-b-row', tabs: [] },
    ]);
  });

  test('does not use parent metadata to group rows without a run', () => {
    const plan = panePlan([
      row('first', { parentPtyId: 'shared-parent' }),
      row('second', { parentPtyId: 'shared-parent', startedAt: 20 }),
    ]);

    expect(plan).toEqual({
      layouts: [],
      unknown: [
        { id: 'first', reason: 'relationship-unavailable' },
        { id: 'second', reason: 'relationship-unavailable' },
      ],
    });
  });
});
