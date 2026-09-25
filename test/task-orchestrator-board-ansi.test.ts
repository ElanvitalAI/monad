import { describe, expect, test } from 'bun:test';
import {
  renderBoardAnsi,
  renderCardLine,
} from '../src/task-orchestrator/board/ansi-renderer.ts';
import { computeBoard } from '../src/task-orchestrator/board/layout.ts';
import { projectTaskToCard } from '../src/task-orchestrator/board/card.ts';
import {
  createTask,
  type TaskStatus,
  type TaskSurface,
} from '../src/task-orchestrator/types.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

function mk(opts: {
  title?: string;
  status?: TaskStatus;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  createdAt?: number;
}): Parameters<typeof computeBoard>[0]['tasks'][number] {
  const t = createTask(
    {
      title: opts.title ?? 't',
      surface: surfaceLlm,
      priority: opts.priority,
    },
    { now: opts.createdAt ?? 1000, allowUncheckedUrgent: true },
  );
  if (opts.status) t.status = opts.status;
  return t;
}

const WIDE = { width: 180, height: 40 };
const GRID = { width: 80, height: 30 };
const COMPACT = { width: 40, height: 20 };

const ansiEscape = /\x1b\[[0-9;]*m/;

describe('renderBoardAnsi', () => {
  test('BA1: empty layout → summary line (or near-empty)', () => {
    const layout = computeBoard({ tasks: [], viewport: WIDE, now: 10_000 });
    const out = renderBoardAnsi(layout, { color: false });
    expect(out).toContain('total: 0');
  });

  test('BA2: wide mode emits 4 column headers', () => {
    const layout = computeBoard({ tasks: [mk({})], viewport: WIDE, now: 5000 });
    const out = renderBoardAnsi(layout, { color: false });
    expect(out).toContain('Backlog');
    expect(out).toContain('In Progress');
    expect(out).toContain('Review');
    expect(out).toContain('Done');
  });

  test('BA3: grid mode has 2x2 structure', () => {
    const layout = computeBoard({ tasks: [mk({})], viewport: GRID, now: 5000 });
    const out = renderBoardAnsi(layout, { color: false });
    // Two separate box tops (wide uses one).
    const topBorders = out.match(/┌─+┬─+┐/g) ?? [];
    expect(topBorders.length).toBe(2);
  });

  test('BA4: compact mode uses ▼ headers + vertical stacking', () => {
    const layout = computeBoard({
      tasks: [mk({ status: 'backlog' }), mk({ status: 'running' })],
      viewport: COMPACT,
      now: 5000,
    });
    const out = renderBoardAnsi(layout, { color: false });
    expect(out).toContain('▼ Backlog');
    expect(out).toContain('▼ In Progress');
  });

  test('BA5: color: false strips ANSI escapes', () => {
    const layout = computeBoard({
      tasks: [mk({ priority: 'urgent' })],
      viewport: WIDE,
      now: 5000,
    });
    const out = renderBoardAnsi(layout, { color: false });
    expect(ansiEscape.test(out)).toBe(false);
  });

  test('BA6: color: true (default) emits ANSI escapes', () => {
    const layout = computeBoard({
      tasks: [mk({ priority: 'urgent' })],
      viewport: WIDE,
      now: 5000,
    });
    const out = renderBoardAnsi(layout);
    expect(ansiEscape.test(out)).toBe(true);
  });

  test('BA7: overflow count rendered as + N more', () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      mk({ title: `t${i}`, status: 'backlog' }),
    );
    const layout = computeBoard({
      tasks,
      viewport: COMPACT,
      now: 5000,
      compactPerColumn: 3,
    });
    const out = renderBoardAnsi(layout, { color: false });
    expect(out).toMatch(/\+\s*12\s*more/);
  });

  test('BA8: showSummary: false omits summary bar', () => {
    const layout = computeBoard({ tasks: [mk({})], viewport: WIDE, now: 5000 });
    const out = renderBoardAnsi(layout, { color: false, showSummary: false });
    expect(out).not.toContain('📊');
  });

  test('BA9: cardLines: 1 → exactly one line per card', () => {
    const layout = computeBoard({
      tasks: [mk({ status: 'backlog', title: 'aaa' })],
      viewport: COMPACT,
      now: 5000,
    });
    const out = renderBoardAnsi(layout, {
      color: false,
      cardLines: 1,
      showSummary: false,
    });
    // The card content line count within Backlog section — no badge lines.
    const backlogSection = out.split('▼ ')[1] ?? '';
    const nonEmptyLines = backlogSection
      .split('\n')
      .filter((l) => l.trim().length > 0 && !l.startsWith('Backlog'));
    // 1 card × 1 line each
    expect(nonEmptyLines.length).toBe(1);
  });

  test('BA10: cardLines: 3 → card + badges + age', () => {
    const layout = computeBoard({
      tasks: [
        mk({ status: 'backlog', title: 'with-badges' }),
      ],
      viewport: COMPACT,
      now: 5000,
    });
    const out = renderBoardAnsi(layout, { color: false, cardLines: 3 });
    expect(out).toContain('age:');
  });

  test('BA11: long title truncated with ellipsis', () => {
    // 80-char title — BoardCard will trim to 40 (default) producing …
    const long = 'x'.repeat(80);
    const layout = computeBoard({
      tasks: [mk({ title: long, status: 'backlog' })],
      viewport: COMPACT,
      now: 5000,
      titleMaxLen: 20,  // force truncation
    });
    const out = renderBoardAnsi(layout, { color: false });
    expect(out).toContain('…');
  });

  test('BA12: surfaceGlyph prefix present on cards', () => {
    const layout = computeBoard({
      tasks: [mk({ status: 'backlog' })],
      viewport: COMPACT,
      now: 5000,
    });
    const out = renderBoardAnsi(layout, { color: false });
    // llm-direct glyph is ✎ (see types.ts surfaceGlyph)
    expect(out).toContain('✎');
  });

  test('BA13: renderCardLine color-codes urgent priority', () => {
    const task = mk({ status: 'backlog', priority: 'urgent' });
    const card = projectTaskToCard(task, { now: 5000 });
    const line = renderCardLine(card, 80, true);
    // 91 = bright red
    expect(line).toContain('\x1b[91m');
  });

  test('BA14: deterministic — same input → same output', () => {
    const tasks = [
      mk({ status: 'backlog', title: 'a' }),
      mk({ status: 'running', title: 'b' }),
    ];
    const layout1 = computeBoard({ tasks, viewport: WIDE, now: 7000 });
    const layout2 = computeBoard({ tasks, viewport: WIDE, now: 7000 });
    const out1 = renderBoardAnsi(layout1, { color: false });
    const out2 = renderBoardAnsi(layout2, { color: false });
    expect(out1).toBe(out2);
  });
});
