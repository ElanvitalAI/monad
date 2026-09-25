import { describe, expect, test } from 'bun:test';

import { createDashboardLogRenderRuntime } from '../src/dashboard/log-render-runtime.js';

describe('createDashboardLogRenderRuntime', () => {
  test('syncs before rendering and returns layout rows', () => {
    const calls: string[] = [];
    const widgetHost = {
      defFor: () => ({ render: () => ['row-1', 'row-2'] }),
      get: () => ({ state: {} }),
      buildContext: () => ({}),
      instances: new Map(),
    };
    const runtime = createDashboardLogRenderRuntime({
      syncLogWidgetState: () => { calls.push('sync'); },
      widgetHost,
      theme: () => ({}),
    });

    const rows = runtime.render(2, 80, 1, true);
    expect(calls).toEqual(['sync']);
    expect(rows).toEqual(['row-1\x1b[0m', 'row-2\x1b[0m']);
  });
});
