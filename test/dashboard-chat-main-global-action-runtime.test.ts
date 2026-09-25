import { describe, expect, mock, test } from 'bun:test';

import {
  createDashboardChatMainGlobalActionRuntime,
} from '../src/dashboard/input/chat-main-global-action-runtime.js';

describe('createDashboardChatMainGlobalActionRuntime', () => {
  test('resize-log reset clears bias and recomputes pane height', async () => {
    const calls: string[] = [];
    const run = createDashboardChatMainGlobalActionRuntime({
      nudgeLogHeightBias: (delta) => { calls.push(`nudge:${delta}`); },
      resetLogHeightBias: () => { calls.push('reset'); },
      recomputePaneHeight: () => { calls.push('recompute'); },
      focusLog: () => { calls.push('focus'); },
      toggleLogZoom: () => { calls.push('zoom'); },
      copyLastBlock: () => { calls.push('copy-last'); },
      spawnTerminalModal: () => { calls.push('spawn-terminal'); },
      copyLogPane: () => { calls.push('copy-log'); },
      rotateProviderNext: () => { calls.push('rotate-provider'); },
    });

    await run({ kind: 'resize-log', delta: 0, reset: true });

    expect(calls).toEqual(['reset', 'recompute']);
  });

  test('resize-log delta nudges bias and recomputes pane height', async () => {
    const calls: string[] = [];
    const run = createDashboardChatMainGlobalActionRuntime({
      nudgeLogHeightBias: (delta) => { calls.push(`nudge:${delta}`); },
      resetLogHeightBias: () => { calls.push('reset'); },
      recomputePaneHeight: () => { calls.push('recompute'); },
      focusLog: () => { calls.push('focus'); },
      toggleLogZoom: () => { calls.push('zoom'); },
      copyLastBlock: () => { calls.push('copy-last'); },
      spawnTerminalModal: () => { calls.push('spawn-terminal'); },
      copyLogPane: () => { calls.push('copy-log'); },
      rotateProviderNext: () => { calls.push('rotate-provider'); },
    });

    await run({ kind: 'resize-log', delta: -5 });

    expect(calls).toEqual(['nudge:-5', 'recompute']);
  });

  test('delegates non-resize actions to their runtime callbacks', async () => {
    const focusLog = mock(() => {});
    const toggleLogZoom = mock(() => {});
    const copyLastBlock = mock(async () => {});
    const spawnTerminalModal = mock(() => {});
    const copyLogPane = mock(async () => {});
    const rotateProviderNext = mock(() => {});
    const run = createDashboardChatMainGlobalActionRuntime({
      nudgeLogHeightBias: () => {},
      resetLogHeightBias: () => {},
      recomputePaneHeight: () => {},
      focusLog,
      toggleLogZoom,
      copyLastBlock,
      spawnTerminalModal,
      copyLogPane,
      rotateProviderNext,
    });

    await run({ kind: 'goto-log' });
    await run({ kind: 'toggle-log-zoom' });
    await run({ kind: 'copy-last-block' });
    await run({ kind: 'spawn-terminal-modal' });
    await run({ kind: 'copy-log-pane' });
    await run({ kind: 'provider-rotate-next' });

    expect(focusLog).toHaveBeenCalled();
    expect(toggleLogZoom).toHaveBeenCalled();
    expect(copyLastBlock).toHaveBeenCalled();
    expect(spawnTerminalModal).toHaveBeenCalled();
    expect(copyLogPane).toHaveBeenCalled();
    expect(rotateProviderNext).toHaveBeenCalled();
  });
});
