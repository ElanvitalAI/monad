import { describe, expect, test } from 'bun:test';

import { createDashboardVirtualWindowMutationRuntime } from '../src/dashboard/virtual-window-mutation-runtime.js';

describe('createDashboardVirtualWindowMutationRuntime', () => {
  test('handles new window and terminal modal toggle flows', () => {
    const lines: string[] = [];
    const warnings: string[] = [];
    const actions: string[] = [];
    let fg: { id: string } | null = { id: 'sess-1' };
    let bg: { id: string } | null = { id: 'sess-2' };

    const runtime = createDashboardVirtualWindowMutationRuntime({
      spawnWindow: () => ({ id: 9 }),
      getForegroundSession: () => fg,
      detachSession: (id) => { actions.push(`detach:${id}`); fg = null; },
      getLatestBackgroundSession: () => bg,
      attachSession: (id, dims) => { actions.push(`attach:${id}:${dims.termCols}x${dims.termRows}`); bg = null; },
      termSize: () => ({ cols: 120, rows: 40 }),
      getCurrentWindow: () => null,
      renameWindow: () => false,
      renamePane: () => {},
      openRenameModal: () => {},
      pushMutedLine: (line) => { lines.push(line); },
      pushWarningLine: (line) => { warnings.push(line); },
      draw: () => {},
    });

    runtime.onNewWindow?.();
    runtime.onModalWindowToggle?.();
    runtime.onModalWindowToggle?.();
    runtime.onModalWindowToggle?.();

    expect(actions).toEqual(['detach:sess-1', 'attach:sess-2:120x40']);
    expect(lines).toEqual([
      '  new virtual window: win:9 (terminal)',
      '  detached session sess-1 (ptytoggle)',
      '  reattached session sess-2 (ptytoggle)',
      '  no terminal session to toggle.',
    ]);
    expect(warnings).toEqual([]);
  });

  test('surfaces failures and rename modal submits', () => {
    const lines: string[] = [];
    const warnings: string[] = [];
    const actions: string[] = [];
    let submittedWindow: ((next: string) => void) | null = null;
    let submittedPane: ((next: string) => void) | null = null;
    let cancelled = 0;

    const runtime = createDashboardVirtualWindowMutationRuntime({
      spawnWindow: () => { throw new Error('spawn boom'); },
      getForegroundSession: () => null,
      detachSession: () => {},
      getLatestBackgroundSession: () => { throw new Error('attach boom'); },
      attachSession: () => {},
      termSize: () => ({ cols: 10, rows: 5 }),
      getCurrentWindow: () => ({
        id: 4,
        title: 'alpha',
        focused: 'pane-123456',
        getPaneDisplayTitle: () => 'notes',
      }),
      renameWindow: (id, next) => { actions.push(`renameWindow:${id}:${next}`); return true; },
      renamePane: (id, paneId, next) => { actions.push(`renamePane:${id}:${paneId}:${next}`); },
      openRenameModal: (spec) => {
        if (spec.title === 'Rename window') submittedWindow = spec.onSubmit;
        else submittedPane = spec.onSubmit;
        spec.onCancel();
        cancelled += 1;
      },
      pushMutedLine: (line) => { lines.push(line); },
      pushWarningLine: (line) => { warnings.push(line); },
      draw: () => { actions.push('draw'); },
    });

    runtime.onNewWindow?.();
    runtime.onModalWindowToggle?.();
    runtime.onRenameWindow?.();
    runtime.onRenamePane?.();
    submittedWindow?.('beta');
    submittedPane?.('docs');

    expect(warnings).toEqual([
      '  new virtual window failed: spawn boom',
      '  session toggle failed: attach boom',
    ]);
    expect(lines).toEqual([
      '  win:4 → beta',
      '  pane:pane-1 → docs',
    ]);
    expect(cancelled).toBe(2);
    expect(actions).toEqual([
      'draw',
      'draw',
      'renameWindow:4:beta',
      'draw',
      'renamePane:4:pane-123456:docs',
      'draw',
    ]);
  });
});
