import { describe, expect, test } from 'bun:test';

import { bootDashboardWidgetInspector } from '../src/dashboard/widget-inspector-boot.js';
import type { WidgetInspectorOps } from '../src/skills/tools/widget-inspector.js';
import type { WidgetHostLike } from '../src/widget-routing/widget-dispatcher.js';

describe('bootDashboardWidgetInspector', () => {
  test('wires widget host and redraw after successful call hook', () => {
    let installed: WidgetInspectorOps | undefined;
    let draws = 0;
    const host: WidgetHostLike = {
      get: () => null,
      defFor: () => null,
      buildContext: () => null,
    };

    bootDashboardWidgetInspector({
      initWidgetInspectorTools: (ops) => { installed = ops; },
      host,
      draw: () => { draws += 1; },
    });

    expect(installed?.host).toBe(host);
    expect(draws).toBe(0);
    installed?.afterCall?.('wd-log', { name: 'enter' });
    expect(draws).toBe(1);
  });
});
