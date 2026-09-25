import { describe, expect, mock, test } from 'bun:test';

import { createDashboardPluginBaseRuntime } from '../src/dashboard/plugin-base-runtime.js';

describe('dashboard plugin base runtime', () => {
  test('log appends a line and clears chat scroll state', () => {
    const pushChatLine = mock((_line: string) => {});
    const clearChatScroll = mock(() => {});
    const runtime = createDashboardPluginBaseRuntime({
      pushChatLine,
      clearChatScroll,
      setHudSegment: mock((_key: string, _value: string, _priority?: number) => {}),
      clearHudSegment: mock((_key: string) => {}),
      requestDashboardRender: mock((_pane?: string) => {}),
      submitDashboardText: mock((_text: string) => {}),
    });

    runtime.log('hello');

    expect(pushChatLine).toHaveBeenCalledWith('hello');
    expect(clearChatScroll).toHaveBeenCalled();
  });

  test('hudSet routes truthy values to set and empty values to clear', () => {
    const setHudSegment = mock((_key: string, _value: string, _priority?: number) => {});
    const clearHudSegment = mock((_key: string) => {});
    const runtime = createDashboardPluginBaseRuntime({
      pushChatLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      setHudSegment,
      clearHudSegment,
      requestDashboardRender: mock((_pane?: string) => {}),
      submitDashboardText: mock((_text: string) => {}),
    });

    runtime.hudSet('voice', 'ON', 5);
    runtime.hudSet('voice', '', 5);

    expect(setHudSegment).toHaveBeenCalledWith('voice', 'ON', 5);
    expect(clearHudSegment).toHaveBeenCalledWith('voice');
  });

  test('requestRender and submitText forward into dashboard callbacks', () => {
    const requestDashboardRender = mock((_pane?: string) => {});
    const submitDashboardText = mock((_text: string) => {});
    const runtime = createDashboardPluginBaseRuntime({
      pushChatLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      setHudSegment: mock((_key: string, _value: string, _priority?: number) => {}),
      clearHudSegment: mock((_key: string) => {}),
      requestDashboardRender,
      submitDashboardText,
    });

    runtime.requestRender('preview');
    runtime.submitText?.('run');

    expect(requestDashboardRender).toHaveBeenCalledWith('preview');
    expect(submitDashboardText).toHaveBeenCalledWith('run');
  });
});
