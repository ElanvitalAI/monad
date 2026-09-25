import { describe, expect, mock, test } from 'bun:test';

import { createMouseModeSwitchRuntime } from '../src/dashboard/input/mouse-mode-switch-runtime.js';

describe('createMouseModeSwitchRuntime', () => {
  test('does nothing when target mode is already active', async () => {
    const getModeAction = mock((_actionId: string) => null);
    const setMode = mock((_next: 'general' | 'sync' | 'control') => {});
    const runtime = createMouseModeSwitchRuntime({
      getActiveMode: () => 'general',
      getModeAction,
      setMode,
    });

    await runtime.onModeSwitch?.('general');

    expect(getModeAction).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
  });

  test('prefers registered mode action handlers', async () => {
    const handler = mock(() => {});
    const runtime = createMouseModeSwitchRuntime({
      getActiveMode: () => 'general',
      getModeAction: (actionId) =>
        actionId === 'mode.enter.sync' ? { handler } : null,
      setMode: () => {},
    });

    await runtime.onModeSwitch?.('sync');

    expect(handler).toHaveBeenCalled();
  });

  test('falls back to direct setMode for general/control', async () => {
    const setMode = mock((_next: 'general' | 'sync' | 'control') => {});
    const runtime = createMouseModeSwitchRuntime({
      getActiveMode: () => 'sync',
      getModeAction: () => null,
      setMode,
    });

    await runtime.onModeSwitch?.('control');

    expect(setMode).toHaveBeenCalledWith('control');
  });
});
