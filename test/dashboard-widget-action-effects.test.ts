import { describe, expect, test } from 'bun:test';

import { runDashboardWidgetAction } from '../src/dashboard/runtime/widget-action-effects.js';

describe('dashboard widget action effects', () => {
  test('scoped submit handler wins before generic submit dispatch', async () => {
    const calls: string[] = [];
    const handled = await runDashboardWidgetAction(
      { type: 'submit', text: 'bell:close' },
      {
        requestRender: (pane) => calls.push(`render:${pane ?? 'all'}`),
        setWorkingFocus: (pane, reason) => calls.push(`focus:${pane}:${reason}`),
        deactivatePlugin: async () => { calls.push('deactivate'); },
        refreshViewsAfterDeactivate: () => calls.push('refresh-views'),
        submitText: (text) => calls.push(`submit:${text}`),
        focusReason: 'widget-test',
        handleScopedSubmitText: (text) => {
          calls.push(`scoped:${text}`);
          return true;
        },
      },
    );
    expect(handled).toBe(true);
    expect(calls).toEqual(['scoped:bell:close']);
  });

  test('generic submit dispatch runs when scoped handler does not consume', async () => {
    const calls: string[] = [];
    await runDashboardWidgetAction(
      { type: 'submit', text: 'session:abc' },
      {
        requestRender: () => calls.push('render'),
        setWorkingFocus: (pane, reason) => calls.push(`focus:${pane}:${reason}`),
        deactivatePlugin: async () => { calls.push('deactivate'); },
        submitText: (text) => calls.push(`submit:${text}`),
        focusReason: 'widget-test',
        handleScopedSubmitText: () => false,
      },
    );
    expect(calls).toEqual(['submit:session:abc']);
  });
});
