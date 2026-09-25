// ── WR-4 · S3.B · scheduler-task-list 4 hook + chart-line stateless ──

import { describe, test, expect } from 'bun:test';
import schedulerWidget, { type SchedulerTaskListState, type SchedulerTaskCard } from '../widgets/scheduler-task-list/widget.js';
import chartLineWidget from '../widgets/chart-line/widget.js';
import type { WidgetContext } from '../src/widgets/types.js';

const card = (taskId: string, title = 'Task'): SchedulerTaskCard => ({
  taskId,
  title,
  status: 'ready',
  targetType: 'agent',
  schedule: '0 9 * * *',
});

function s(overrides: Partial<SchedulerTaskListState> = {}): SchedulerTaskListState {
  return {
    cards: [],
    cursor: 0,
    offset: 0,
    focused: false,
    ...overrides,
  };
}

const ctx = { character: 'Scheduler' } as WidgetContext<SchedulerTaskListState>;

describe('wd-scheduler-task-list · WR-4 · describeSurface', () => {
  test('empty list — emptyLabel is surfaced', () => {
    const out = schedulerWidget.describeSurface!(s({ emptyLabel: 'no tasks scheduled' }), ctx);
    expect(out).toContain('Scheduler');
    expect(out).toContain('no tasks scheduled');
  });

  test('non-empty — task count + cursor', () => {
    const out = schedulerWidget.describeSurface!(s({
      cards: [card('a'), card('b'), card('c')],
      cursor: 1,
    }), ctx);
    expect(out).toContain('3 tasks');
    expect(out).toContain('cursor 1');
  });

  test('focused bit appears when focused', () => {
    const out = schedulerWidget.describeSurface!(s({
      cards: [card('a')],
      focused: true,
    }), ctx);
    expect(out).toContain('focused');
  });
});

describe('wd-scheduler-task-list · WR-4 · snapshotHash', () => {
  const hash = (st: SchedulerTaskListState) => schedulerWidget.snapshotHash!(st);

  test('cursor delta → distinct hash', () => {
    const cards = [card('a'), card('b')];
    expect(hash(s({ cards, cursor: 0 }))).not.toBe(hash(s({ cards, cursor: 1 })));
  });

  test('cards.length delta → distinct hash', () => {
    expect(hash(s({ cards: [card('a')] }))).not.toBe(hash(s({ cards: [card('a'), card('b')] })));
  });

  test('focused toggle → distinct hash', () => {
    const cards = [card('a')];
    expect(hash(s({ cards, focused: false }))).not.toBe(hash(s({ cards, focused: true })));
  });
});

describe('wd-scheduler-task-list · WR-4 · onStateChange', () => {
  test('emits scheduler-task-list.cards.change when cards.length differs', () => {
    const events: Array<{ kind: string }> = [];
    const tCtx = {
      character: 'Scheduler',
      telemetry: { emit: (e: { kind: string }) => events.push(e) },
    } as unknown as WidgetContext<SchedulerTaskListState>;
    schedulerWidget.onStateChange!(s({ cards: [card('a')] }), s({ cards: [card('a'), card('b')] }), tCtx);
    expect(events.some((e) => e.kind === 'scheduler-task-list.cards.change')).toBe(true);
  });

  test('focus toggle does not emit (host already publishes focus events)', () => {
    const events: unknown[] = [];
    const tCtx = {
      character: 'Scheduler',
      telemetry: { emit: (e: unknown) => events.push(e) },
    } as unknown as WidgetContext<SchedulerTaskListState>;
    const cards = [card('a')];
    schedulerWidget.onStateChange!(s({ cards, focused: false }), s({ cards, focused: true }), tCtx);
    expect(events).toHaveLength(0);
  });
});

describe('wd-chart-line · WR-4 stateless', () => {
  test('no onStateChange / snapshotHash / describeSurface hooks', () => {
    expect(chartLineWidget.onStateChange).toBeUndefined();
    expect(chartLineWidget.snapshotHash).toBeUndefined();
    expect(chartLineWidget.describeSurface).toBeUndefined();
  });
});
