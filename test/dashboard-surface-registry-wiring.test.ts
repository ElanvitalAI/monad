import { describe, expect, mock, test } from 'bun:test';

import { wireDashboardSurfaceRegistry } from '../src/dashboard/surface-registry-wiring.js';

describe('dashboard surface registry wiring', () => {
  test('wires modal, widget, and window adapters against the shared registry', () => {
    const surfaceRegistry = {} as never;
    const widgetHost = {} as never;
    const windowRegistry = {} as never;
    const wireModal = mock((_opts: { registry: unknown }) => {});
    const wireWidget = mock((_opts: { registry: unknown; widgetHost: unknown }) => {});
    const windowHandle = { dispose: mock(() => {}), size: mock(() => 0) };
    const wireWindows = mock((_opts: { windowRegistry: unknown; surfaceRegistry: unknown }) => windowHandle);

    const result = wireDashboardSurfaceRegistry({
      surfaceRegistry,
      widgetHost,
      windowRegistry,
      wireModal,
      wireWidget,
      wireWindows,
    });

    expect(wireModal).toHaveBeenCalledWith({ registry: surfaceRegistry });
    expect(wireWidget).toHaveBeenCalledWith({ registry: surfaceRegistry, widgetHost });
    expect(wireWindows).toHaveBeenCalledWith({ windowRegistry, surfaceRegistry });
    expect(result).toEqual({ windowHandle });
  });
});
