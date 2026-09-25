import { describe, expect, test } from 'bun:test';
import { createLogSearchModal } from '../src/log-pane/search-modal.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

describe('createLogSearchModal', () => {
  test('uses the shared picker chrome when themed', () => {
    const handle = createLogSearchModal({
      linesGetter: () => ['alpha line', 'beta line'],
      termCols: 100,
      termRows: 40,
      anchorRow: 10,
      anchorCol: 20,
      theme: DEFAULT_THEME_TOKENS,
      onJump: () => {},
    });
    const out = handle.surface.paint();
    expect(out).toContain('Log search');
    expect(out).toContain('✕');
  });

  test('single-click selects, double-click jumps', () => {
    const jumped: string[] = [];
    const handle = createLogSearchModal({
      linesGetter: () => ['alpha line', 'beta line'],
      initialQuery: 'beta',
      termCols: 100,
      termRows: 40,
      anchorRow: 10,
      anchorCol: 20,
      theme: DEFAULT_THEME_TOKENS,
      onJump: (result) => { jumped.push(result.preview); },
    });
    handle.surface.paint();
    const bounds = handle.surface.bounds;
    const row = bounds.row + 2;
    const col = bounds.col + 3;
    expect(handle.handleMouse(mouse('click', row, col))).toBe('consumed');
    expect(jumped).toHaveLength(0);
    expect(handle.handleMouse(mouse('double-click', row, col))).toBe('consumed');
    expect(jumped).toEqual(['beta line']);
  });
});
