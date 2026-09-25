import { describe, expect, test } from 'bun:test';

import { createDashboardVirtualWindowSplitRuntime } from '../src/dashboard/virtual-window-split-runtime.js';

describe('createDashboardVirtualWindowSplitRuntime', () => {
  test('spawns terminal slot and binds placement', () => {
    const actions: string[] = [];
    const lines: string[] = [];
    const warnings: string[] = [];
    const runtime = createDashboardVirtualWindowSplitRuntime({
      getCurrentWindow: () => ({
        id: 7,
        splitFocused: (axis) => {
          actions.push(`split:${axis}`);
          return 'pane-new';
        },
      }),
      spawnTerminal: ({ title, cwd }) => {
        actions.push(`spawn:${title}:${cwd}`);
        return { id: 'term:9', title: 'term-title', legacySessionId: 'sess-2' };
      },
      cwd: () => '/tmp/work',
      detachSession: (id) => { actions.push(`detach:${id}`); },
      getCurrentTerminalModalId: () => 'sess-2',
      clearCurrentTerminalModal: () => { actions.push('clear-modal'); },
      createTerminalSlotContent: ({ terminalId, title }) => {
        actions.push(`content:${terminalId}:${title}`);
        return { terminalId, title };
      },
      bindSlot: (slotKey, paneId) => { actions.push(`bind:${slotKey}:${paneId}`); },
      setPlacement: (terminalId, placement) => {
        actions.push(`place:${terminalId}:${placement.windowId}/${placement.slotId}`);
      },
      pushMutedLine: (line) => { lines.push(line); },
      pushWarningLine: (line) => { warnings.push(line); },
      draw: () => { actions.push('draw'); },
    });

    runtime.onSplit?.('h');

    expect(actions).toEqual([
      'spawn:split-h:/tmp/work',
      'detach:sess-2',
      'clear-modal',
      'content:term:9:term-title',
      'split:h',
      'bind:7/pane-new:pane-new',
      'place:term:9:7/pane-new',
      'draw',
    ]);
    expect(lines).toEqual(['  split h: term:9 → pane:pane-new']);
    expect(warnings).toEqual([]);
  });

  test('surfaces missing window and split failures', () => {
    const lines: string[] = [];
    const warnings: string[] = [];
    const runtimeA = createDashboardVirtualWindowSplitRuntime({
      getCurrentWindow: () => null,
      spawnTerminal: () => ({ id: 'term:1', title: 'x' }),
      cwd: () => '/tmp',
      detachSession: () => {},
      getCurrentTerminalModalId: () => null,
      clearCurrentTerminalModal: () => {},
      createTerminalSlotContent: () => ({}),
      bindSlot: () => {},
      setPlacement: () => {},
      pushMutedLine: (line) => { lines.push(line); },
      pushWarningLine: (line) => { warnings.push(line); },
      draw: () => {},
    });
    runtimeA.onSplit?.('v');

    const runtimeB = createDashboardVirtualWindowSplitRuntime({
      getCurrentWindow: () => ({ id: 1, splitFocused: () => { throw new Error('bad split'); } }),
      spawnTerminal: () => ({ id: 'term:1', title: 'x' }),
      cwd: () => '/tmp',
      detachSession: () => {},
      getCurrentTerminalModalId: () => null,
      clearCurrentTerminalModal: () => {},
      createTerminalSlotContent: () => ({}),
      bindSlot: () => {},
      setPlacement: () => {},
      pushMutedLine: (line) => { lines.push(line); },
      pushWarningLine: (line) => { warnings.push(line); },
      draw: () => {},
    });
    runtimeB.onSplit?.('v');

    expect(lines).toEqual(['No foreground virtual window to split.']);
    expect(warnings).toEqual(['  split failed: bad split']);
  });
});
