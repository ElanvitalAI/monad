import { describe, expect, test } from 'bun:test';

import {
  resolveDashboardActionFocusTarget,
  runDashboardAction,
} from '../src/dashboard/runtime/action-effects.js';

describe('dashboard action effects', () => {
  test('focus target maps pane slots to dashboard focus panes', () => {
    expect(resolveDashboardActionFocusTarget('skills')).toBe('browser');
    expect(resolveDashboardActionFocusTarget('files')).toBe('browser');
    expect(resolveDashboardActionFocusTarget('preview')).toBe('preview');
    expect(resolveDashboardActionFocusTarget('log')).toBe('log');
  });

  test('submit action reuses dashboard submitText handler', async () => {
    const calls: string[] = [];
    await runDashboardAction(
      { type: 'submit', text: 'file-attach:/tmp/demo.txt' },
      {
        requestRender: (pane) => calls.push(`render:${pane ?? 'all'}`),
        setWorkingFocus: (pane, reason) => calls.push(`focus:${pane}:${reason}`),
        deactivatePlugin: async () => { calls.push('deactivate'); },
        refreshViewsAfterDeactivate: () => calls.push('refresh-views'),
        submitText: (text) => calls.push(`submit:${text}`),
        focusReason: 'test-focus',
      },
    );
    expect(calls).toEqual(['submit:file-attach:/tmp/demo.txt']);
  });
});
