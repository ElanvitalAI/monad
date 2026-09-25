import { describe, expect, mock, test } from 'bun:test';

import { createMousePillContextRuntime } from '../src/dashboard/input/mouse-pill-context-runtime.js';

describe('createMousePillContextRuntime', () => {
  test('skips when no handle exists for the pill', () => {
    const showMenu = mock(async (_handle: unknown, _pos: { x: number; y: number }) => undefined);
    const runtime = createMousePillContextRuntime({
      handleForPill: () => null,
      showMenu,
    });

    runtime.onPillRightClick?.('model', { x: 1, y: 2 });

    expect(showMenu).not.toHaveBeenCalled();
  });

  test('opens context menu for resolved pill handle', async () => {
    const showMenu = mock(async (_handle: unknown, _pos: { x: number; y: number }) => undefined);
    const handle = { id: 'pill:model' };
    const runtime = createMousePillContextRuntime({
      handleForPill: () => handle,
      showMenu,
    });

    runtime.onPillRightClick?.('model', { x: 3, y: 4 });
    await Promise.resolve();

    expect(showMenu).toHaveBeenCalledWith(handle, { x: 3, y: 4 });
  });

  test('forwards select result to onPillMenuPick', async () => {
    const handle = { id: 'pill:model' };
    const showMenu = mock(
      async () => ({ value: 'pill.remove', reason: 'selected' }),
    );
    const onPillMenuPick = mock(() => undefined);
    const runtime = createMousePillContextRuntime({
      handleForPill: () => handle,
      showMenu,
      onPillMenuPick,
    });

    runtime.onPillRightClick?.('model', { x: 0, y: 0 });
    // Wait for the showMenu Promise + .then chain to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(onPillMenuPick).toHaveBeenCalledWith('model', 'pill.remove', { x: 0, y: 0 });
  });

  test('skips onPillMenuPick when reason is not selected', async () => {
    const showMenu = mock(
      async () => ({ value: 'pill.switch', reason: 'escape' }),
    );
    const onPillMenuPick = mock(() => undefined);
    const runtime = createMousePillContextRuntime({
      handleForPill: () => ({}),
      showMenu,
      onPillMenuPick,
    });

    runtime.onPillRightClick?.('model', { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onPillMenuPick).not.toHaveBeenCalled();
  });

  test('skips onPillMenuPick for non-string value', async () => {
    const showMenu = mock(
      async () => ({ value: 42 as unknown, reason: 'selected' }),
    );
    const onPillMenuPick = mock(() => undefined);
    const runtime = createMousePillContextRuntime({
      handleForPill: () => ({}),
      showMenu,
      onPillMenuPick,
    });

    runtime.onPillRightClick?.('model', { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onPillMenuPick).not.toHaveBeenCalled();
  });

  test('listener throw does not break promise chain', async () => {
    const showMenu = mock(
      async () => ({ value: 'pill.switch', reason: 'selected' }),
    );
    const onPillMenuPick = mock(() => {
      throw new Error('boom');
    });
    const runtime = createMousePillContextRuntime({
      handleForPill: () => ({}),
      showMenu,
      onPillMenuPick,
    });

    runtime.onPillRightClick?.('model', { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onPillMenuPick).toHaveBeenCalled();
  });
});
