import { describe, expect, mock, test } from 'bun:test';

import { createDashboardWidgetHostRuntime } from '../src/dashboard/widget-host-runtime.js';

describe('dashboard widget host runtime', () => {
  test('log appends a debug line and clears chat scroll state', () => {
    const pushDebugLine = mock((_line: string) => {});
    const clearChatScroll = mock(() => {});
    const runtime = createDashboardWidgetHostRuntime({
      pushDebugLine,
      clearChatScroll,
      requestDashboardRender: mock(() => {}),
      display: {} as never,
      getWidgetHost: () => null,
      getWidgetSurfaceDescriptor: () => undefined,
    });

    runtime.log('widget line');

    expect(pushDebugLine).toHaveBeenCalledWith('widget line');
    expect(clearChatScroll).toHaveBeenCalled();
  });

  test('scheduleFrame dedupes pending ticks and tail-calls the live widget host after render', () => {
    const requestDashboardRender = mock(() => {});
    const scheduleNextFrameIfAnimating = mock((_delayMs?: number) => {});
    const scheduled: Array<() => void> = [];
    const runtime = createDashboardWidgetHostRuntime({
      pushDebugLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      requestDashboardRender,
      display: {} as never,
      getWidgetHost: () => ({ scheduleNextFrameIfAnimating }),
      getWidgetSurfaceDescriptor: () => undefined,
      scheduleTimeout: (cb) => { scheduled.push(cb); },
    });

    runtime.scheduleFrame?.(16);
    runtime.scheduleFrame?.(16);
    expect(scheduled).toHaveLength(1);

    scheduled[0]();

    expect(requestDashboardRender).toHaveBeenCalled();
    expect(scheduleNextFrameIfAnimating).toHaveBeenCalledWith(16);
  });

  test('zInfoFor projects tier and zHint from the live surface descriptor', () => {
    const runtime = createDashboardWidgetHostRuntime({
      pushDebugLine: mock((_line: string) => {}),
      clearChatScroll: mock(() => {}),
      requestDashboardRender: mock(() => {}),
      display: {} as never,
      getWidgetHost: () => null,
      getWidgetSurfaceDescriptor: (id) => id === 'w-1'
        ? {
            addr: { kind: 'widget', widgetId: 'w-1' },
            kindTag: 'demo',
            visible: true,
            registeredAt: 1,
            tier: 'vw',
            zHint: 4,
          }
        : undefined,
    });

    expect(runtime.zInfoFor?.('w-1')).toEqual({ tier: 'vw', zIndex: 4 });
    expect(runtime.zInfoFor?.('missing')).toBeUndefined();
  });
});
