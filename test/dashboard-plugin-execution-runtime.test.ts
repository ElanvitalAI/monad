import { describe, expect, mock, test } from 'bun:test';

import { createDashboardPluginExecutionRuntime } from '../src/dashboard/plugin-execution-runtime.js';

describe('dashboard plugin execution runtime', () => {
  test('spawn applies preview defaults and updates dashboard execution state', () => {
    const requestDashboardRender = mock((_pane?: string) => {});
    const registerExecutionSurface = mock((_handle: unknown) => {});
    const setActiveExecutionSurfaceId = mock((_id: string | null) => {});
    const setPreviewTerminalDims = mock((_dims: { cols: number; rows: number }) => {});
    const setWorkingFocusPreview = mock(() => {});
    const clearChatScroll = mock(() => {});
    const pushChatLine = mock((_line: string) => {});

    const handle = {
      id: 'execution:test',
      surface: {} as never,
      terminal: {} as never,
      start: mock(() => {}),
      stop: mock(() => {}),
      resize: mock((_cols: number, _rows: number) => {}),
      write: mock((_bytes: string) => {}),
      render: mock((_ctx: unknown) => []),
      dispose: mock(() => {}),
    };
    const createSurface = mock((_spec, _opts) => handle);

    const runtime = createDashboardPluginExecutionRuntime({
      computePreviewTerminalDims: () => ({ cols: 120, rows: 36 }),
      display: {} as never,
      focusManager: {} as never,
      displayEvents: {} as never,
      requestDashboardRender,
      pushChatLine,
      clearChatScroll,
      onExecutionSurfaceExit: mock((_id: string) => {}),
      registerExecutionSurface,
      setActiveExecutionSurfaceId,
      setPreviewTerminalDims,
      setWorkingFocusPreview,
      formatExecutionExitLine: (id, code) => `Execution ${id} exited (${code}).`,
      createSurface,
    });

    const spawned = runtime.spawn({ cwd: '/tmp', command: 'echo ok' });

    expect(spawned).toBe(handle);
    expect(createSurface).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp',
      command: 'echo ok',
      placement: 'preview',
      cols: 120,
      rows: 36,
    }), expect.any(Object));
    expect(registerExecutionSurface).toHaveBeenCalledWith(handle);
    expect(setActiveExecutionSurfaceId).toHaveBeenCalledWith('execution:test');
    expect(handle.start).toHaveBeenCalled();
    expect(setPreviewTerminalDims).toHaveBeenCalledWith({ cols: 120, rows: 36 });
    expect(setWorkingFocusPreview).toHaveBeenCalled();
    expect(requestDashboardRender).toHaveBeenCalledWith('preview');
    expect(clearChatScroll).not.toHaveBeenCalled();
    expect(pushChatLine).not.toHaveBeenCalled();
  });

  test('spawn onExit logs, clears scroll, tears down active execution state, and rerenders preview', () => {
    const requestDashboardRender = mock((_pane?: string) => {});
    const onExecutionSurfaceExit = mock((_id: string) => {});
    const clearChatScroll = mock(() => {});
    const pushChatLine = mock((_line: string) => {});

    let capturedOnExit: ((id: string, code: number) => void) | null = null;
    const handle = {
      id: 'execution:test',
      surface: {} as never,
      terminal: {} as never,
      start: mock(() => {}),
      stop: mock(() => {}),
      resize: mock((_cols: number, _rows: number) => {}),
      write: mock((_bytes: string) => {}),
      render: mock((_ctx: unknown) => []),
      dispose: mock(() => {}),
    };
    const createSurface = mock((_spec, opts: { onExit?: (id: string, code: number) => void }) => {
      capturedOnExit = opts.onExit ?? null;
      return handle;
    });

    const runtime = createDashboardPluginExecutionRuntime({
      computePreviewTerminalDims: () => ({ cols: 100, rows: 30 }),
      display: {} as never,
      focusManager: {} as never,
      displayEvents: {} as never,
      requestDashboardRender,
      pushChatLine,
      clearChatScroll,
      onExecutionSurfaceExit,
      registerExecutionSurface: mock((_handle: unknown) => {}),
      setActiveExecutionSurfaceId: mock((_id: string | null) => {}),
      setPreviewTerminalDims: mock((_dims: { cols: number; rows: number }) => {}),
      setWorkingFocusPreview: mock(() => {}),
      formatExecutionExitLine: (id, code) => `Execution ${id} exited (${code}).`,
      createSurface,
    });

    runtime.spawn({ cwd: '/tmp' });
    expect(capturedOnExit).not.toBeNull();

    capturedOnExit?.('execution:test', 9);

    expect(pushChatLine).toHaveBeenCalledWith('Execution execution:test exited (9).');
    expect(clearChatScroll).toHaveBeenCalled();
    expect(onExecutionSurfaceExit).toHaveBeenCalledWith('execution:test');
    expect(requestDashboardRender).toHaveBeenCalledWith('preview');
  });
});
