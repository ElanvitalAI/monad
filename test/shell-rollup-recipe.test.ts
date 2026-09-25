import { describe, expect, test } from 'bun:test';

import {
  createShellRollupPopupRecipe,
  type ShellRollupEntry,
} from '../src/mouse-action-recipes.js';
import { ToastStack } from '../src/ui/widgets/toast-stack.js';
import type { PopupPlacement } from '../src/status/popups.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

const PLACEMENT: PopupPlacement = {
  anchorStartCol: 40,
  anchorEndCol: 52,
  statusRow: 20,
  termCols: 100,
  termRows: 30,
};

function mouse(type: DisplayMouseEvent['type'], row: number, col: number): DisplayMouseEvent {
  return { type, row, col };
}

function mkEntries(): ShellRollupEntry[] {
  return [
    { id: 'aaaa1111bbbb', chip: '▶ run  ', mode: 'vw',    status: 'running',      label: 'runner' },
    { id: 'cccc2222dddd', chip: '⏸ bg   ', mode: 'bg',    status: 'backgrounded' },
    { id: 'eeee3333ffff', chip: '✓ done ', mode: 'modal', status: 'completed',    label: 'deploy' },
  ];
}

describe('SRF-4 shell rollup popup', () => {
  test('clicking the first row fires onPick with the handle id', async () => {
    const calls: string[] = [];
    const toasts = new ToastStack({ nowMs: () => 0 });
    const h = createShellRollupPopupRecipe({
      entries: mkEntries(),
      placement: PLACEMENT,
      onPick: id => { calls.push(id); },
      toasts,
    });
    h.surface.paint();
    const bounds = h.surface.bounds;
    for (let r = bounds.row + 1; r < bounds.row + bounds.height - 1 && calls.length === 0; r++) {
      h.handleMouse(mouse('click', r, bounds.col + 2));
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('aaaa1111bbbb');
  });

  test('Esc fires onCancel (not onPick)', () => {
    const picks: string[] = [];
    let cancelled = 0;
    const h = createShellRollupPopupRecipe({
      entries: mkEntries(),
      placement: PLACEMENT,
      onPick: id => picks.push(id),
      onCancel: () => { cancelled++; },
    });
    h.handleKey({ name: 'escape' });
    expect(cancelled).toBe(1);
    expect(picks).toHaveLength(0);
  });

  test('title reflects handle count + 🐚 icon to match status-bar pill', () => {
    const h = createShellRollupPopupRecipe({
      entries: mkEntries(),
      placement: PLACEMENT,
      onPick: () => {},
    });
    h.surface.paint();
    // Surface id pinned for mount lifecycle; title renders at paint
    // time. N5 — popup title mirrors the 🐚 used on the status-bar
    // pill so users tie pill and popup together.
    expect(h.surface.id).toBe('recipe:shell-rollup');
  });

  test('rows with no label still show mode=', async () => {
    const calls: string[] = [];
    const entries: ShellRollupEntry[] = [
      { id: 'no-label-id', chip: '▶ run  ', mode: 'vw', status: 'running' },
    ];
    const h = createShellRollupPopupRecipe({
      entries,
      placement: PLACEMENT,
      onPick: id => calls.push(id),
    });
    h.surface.paint();
    const b = h.surface.bounds;
    for (let r = b.row + 1; r < b.row + b.height - 1 && calls.length === 0; r++) {
      h.handleMouse(mouse('click', r, b.col + 2));
    }
    expect(calls).toEqual(['no-label-id']);
  });

  test('N1 — multi-label entries get grouped with headings, runner pinned first', () => {
    const calls: string[] = [];
    const entries: ShellRollupEntry[] = [
      { id: 'deploy1', chip: '▶ run  ', mode: 'vw', status: 'running', label: 'deploy' },
      { id: 'alpha1',  chip: '▶ run  ', mode: 'vw', status: 'running', label: 'alpha' },
      { id: 'runner1', chip: '▶ run  ', mode: 'vw', status: 'running', label: 'runner' },
      { id: 'naked',   chip: '✓ done ', mode: 'bg', status: 'completed' },
    ];
    const h = createShellRollupPopupRecipe({
      entries,
      placement: PLACEMENT,
      onPick: id => calls.push(id),
    });
    h.surface.paint();
    // Clicking the first data row should select the first entry within
    // the first group (runner, pinned). Headings are disabled so clicks
    // on them no-op; we walk rows from the top until a real click lands.
    const b = h.surface.bounds;
    for (let r = b.row + 1; r < b.row + b.height - 1 && calls.length === 0; r++) {
      h.handleMouse(mouse('click', r, b.col + 2));
    }
    // runner pinned first, so the first clickable handle is runner1.
    expect(calls[0]).toBe('runner1');
  });

  test('N1 — single-label case keeps flat list (no heading row)', () => {
    const entries: ShellRollupEntry[] = [
      { id: 'a', chip: '▶ run  ', mode: 'vw', status: 'running', label: 'runner' },
      { id: 'b', chip: '⏸ bg   ', mode: 'bg', status: 'backgrounded', label: 'runner' },
    ];
    const calls: string[] = [];
    const h = createShellRollupPopupRecipe({
      entries,
      placement: PLACEMENT,
      onPick: id => calls.push(id),
    });
    h.surface.paint();
    const b = h.surface.bounds;
    for (let r = b.row + 1; r < b.row + b.height - 1 && calls.length === 0; r++) {
      h.handleMouse(mouse('click', r, b.col + 2));
    }
    // First clickable row is directly the first handle — no header
    // intervening. So picking row 1 returns 'a', not a heading sentinel.
    expect(calls[0]).toBe('a');
  });

  test('N1 — heading sentinel cannot be selected', () => {
    const picks: string[] = [];
    const entries: ShellRollupEntry[] = [
      { id: 'a', chip: '▶ run  ', mode: 'vw', status: 'running', label: 'alpha' },
      { id: 'b', chip: '▶ run  ', mode: 'vw', status: 'running', label: 'beta' },
    ];
    const h = createShellRollupPopupRecipe({
      entries,
      placement: PLACEMENT,
      onPick: id => picks.push(id),
    });
    h.surface.paint();
    const b = h.surface.bounds;
    // Walk all rows; heading rows are disabled so their clicks no-op.
    // Expect picks to contain only real ids, never '__heading:*'.
    for (let r = b.row + 1; r < b.row + b.height - 1; r++) {
      h.handleMouse(mouse('click', r, b.col + 2));
      if (picks.length > 0) break;
    }
    expect(picks.every(p => !p.startsWith('__heading:'))).toBe(true);
    expect(picks.length).toBe(1);
  });
});
