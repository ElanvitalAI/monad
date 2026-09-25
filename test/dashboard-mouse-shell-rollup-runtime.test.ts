import { describe, expect, mock, test } from 'bun:test';

import {
  createMouseShellRollupRuntime,
  listMouseShellRollupEntries,
} from '../src/dashboard/input/mouse-shell-rollup-runtime.js';

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mouse shell rollup runtime', () => {
  test('lists shell rollup entries from registry + chip renderer', async () => {
    const entries = listMouseShellRollupEntries({
      resolveVwIdByLabel: () => null,
      switchToVirtualWindow: () => {},
      onWarning: () => {},
      loadRegistry: () => ({
        list: () => [{ id: 'h1', mode: 'vw', status: 'running' }],
        get: () => null,
        getVwLabel: () => 'Runner',
      }),
      loadRenderHandleStatusChip: () => (status) => `chip:${status}`,
    });

    expect(entries).toEqual([
      { id: 'h1', chip: 'chip:running', mode: 'vw', status: 'running', label: 'Runner' },
    ]);
  });

  test('switches vw on attach outcome', async () => {
    const switchToVirtualWindow = mock((_windowId: number) => {});
    const runtime = createMouseShellRollupRuntime({
      resolveVwIdByLabel: (label) => label === 'Runner' ? 7 : null,
      switchToVirtualWindow,
      onWarning: () => {},
      loadRegistry: () => ({
        list: () => [],
        get: (id) => id === 'h1' ? { id: 'h1', mode: 'vw', status: 'running' } : null,
        getVwLabel: () => 'Runner',
      }),
      loadDecideAttach: async () => () => ({ kind: 'switch-vw', windowId: 7 }),
    });

    runtime.onShellRollupPick?.('h1');
    await flushAsyncWork();

    expect(switchToVirtualWindow).toHaveBeenCalledWith(7);
  });

  test('reports warnings for non-switch outcomes', async () => {
    const onWarning = mock((_message: string) => {});
    const runtime = createMouseShellRollupRuntime({
      resolveVwIdByLabel: () => null,
      switchToVirtualWindow: () => {},
      onWarning,
      loadRegistry: () => ({
        list: () => [],
        get: () => ({ id: 'h1', mode: 'bg', status: 'backgrounded' }),
        getVwLabel: () => null,
      }),
      loadDecideAttach: async () => () => ({
        kind: 'bg',
        reason: 'bg-mode handle has no attachable surface',
      }),
    });

    runtime.onShellRollupPick?.('h1');
    await flushAsyncWork();

    expect(onWarning).toHaveBeenCalledWith('bg-mode handle has no attachable surface');
  });
});
