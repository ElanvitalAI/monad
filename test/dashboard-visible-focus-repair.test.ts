import { describe, expect, test } from 'bun:test';

import { applyVisibleFocusRepair } from '../src/dashboard/focus-repair.js';
import { repairFocusForVisiblePanes } from '../src/views/pane-policy.js';

describe('dashboard visible focus repair', () => {
  test('does not call setWorkingFocus when the visible focus is already valid', () => {
    const calls: string[] = [];
    const repaired = repairFocusForVisiblePanes('browser', 1, { cols: 160, rows: 40 });

    applyVisibleFocusRepair('browser', repaired, (next, reason) => calls.push(`${next}:${reason}`));

    expect(repaired).toBe('browser');
    expect(calls).toEqual([]);
  });

  test('calls setWorkingFocus exactly once when a closed pane invalidates focus', () => {
    const calls: string[] = [];
    const repaired = repairFocusForVisiblePanes('preview', 1, { cols: 160, rows: 40 }, {
      panes: ['browser', 'preview', 'sessions-sidebar', 'log'],
      closed: new Set(['preview']),
    });

    applyVisibleFocusRepair('preview', repaired, (next, reason) => calls.push(`${next}:${reason}`));

    expect(repaired).not.toBe('preview');
    expect(calls).toEqual([`${repaired}:repair-visible-focus`]);
  });
});
