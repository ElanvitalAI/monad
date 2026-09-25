import { test, expect, describe } from 'bun:test';
import { renderSelfDevBoard } from './board.js';
import { createTask } from '../task-orchestrator/types.js';

describe('renderSelfDevBoard (S3 live board)', () => {
  test('renders self-dev tasks into a kanban string', () => {
    const t = createTask({
      title: 'buildwidget',
      surface: { kind: 'self-implement', feature: 'build a widget' },
      isolation: 'worktree',
    });
    const out = renderSelfDevBoard([t], { color: false, width: 120 });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('buildwidget');
  });

  test('empty task list renders without throwing', () => {
    expect(() => renderSelfDevBoard([], { color: false })).not.toThrow();
  });
});
