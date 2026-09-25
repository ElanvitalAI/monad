import { describe, expect, mock, test } from 'bun:test';

import { registerDashboardWidgetRuntimes } from '../src/dashboard/widget-runtime-registration.js';

describe('registerDashboardWidgetRuntimes', () => {
  test('registers surface-ui, capture, and materialize runtimes from the same widget host', async () => {
    const widgetHost = {
      listTypes: mock(() => [{ type: 'demo', description: 'x', source: 'builtin' }]),
      spawn: mock((_opts: unknown) => 'widget-1'),
    };
    const paneVisualStateStore = {} as never;
    const getProvider = mock(() => ({ provider: 'demo' }));

    const surfaceCalls: unknown[] = [];
    const captureCalls: unknown[] = [];
    const materializeCalls: Array<{
      getProvider: unknown;
      listWidgetTypes: ReturnType<typeof widgetHost.listTypes>;
      spawnWidgetResult: unknown;
      defaultSkipTypes: readonly string[];
    }> = [];
    registerDashboardWidgetRuntimes({
      widgetHost: widgetHost as never,
      paneVisualStateStore,
      getProvider,
      registerSurfaceUi: ((opts) => { surfaceCalls.push(opts); }) as never,
      registerCapture: ((opts) => { captureCalls.push(opts); }) as never,
      registerMaterialize: ((deps) => {
        materializeCalls.push({
          getProvider: deps.getProvider,
          listWidgetTypes: deps.listWidgetTypes(),
          spawnWidgetResult: deps.spawnWidget({ type: 'demo' } as never),
          defaultSkipTypes: deps.defaultSkipTypes ?? [],
        });
      }) as never,
    });

    expect(surfaceCalls).toEqual([{
      widgetHost,
      store: paneVisualStateStore,
    }]);
    expect(captureCalls).toEqual([{
      widgetHost,
      inspectDeps: {
        store: paneVisualStateStore,
        widgetHost,
      },
    }]);
    expect(materializeCalls).toEqual([{
      getProvider,
      listWidgetTypes: [{ type: 'demo', description: 'x', source: 'builtin' }],
      spawnWidgetResult: 'widget-1',
      defaultSkipTypes: ['iul-canvas'],
    }]);
  });
});
