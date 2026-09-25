import { describe, expect, test } from 'bun:test';

import { createDashboardViewSlashRuntime } from '../src/dashboard/view-slash-runtime.js';

describe('createDashboardViewSlashRuntime', () => {
  test('renders view slash lines', () => {
    const runtime = createDashboardViewSlashRuntime({
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
      warning: (text) => `warning:${text}`,
    });

    expect(runtime.listLines([
      { active: true, id: 'main', label: 'Main', enabled: true, shortcut: '1', baseView: 'default' },
    ])).toEqual([
      'muted:  * main Main [on] shortcut=1 base=default',
    ]);
    expect(runtime.closedPaneLines(['Preview', 'Scratch'])).toEqual([
      'muted:  current view closed panes: Preview, Scratch',
      'muted:  restore: Menu -> Add Surface -> Current View or pane title menu',
    ]);
    expect(runtime.reloadedLine()).toBe('muted:  dashboard view config reloaded');
    expect(runtime.savedLine()).toBe('success:  dashboard view config saved');
    expect(runtime.restoredLine()).toBe('success:  current starter panes restored');
    expect(runtime.resetLine()).toBe('success:  dashboard view config reset to built-in defaults');
    expect(runtime.exportedLine()).toBe('muted:  dashboard view config exported to detail viewer');
    expect(runtime.usageLine()).toBe('warning:  Usage: /view <id|label|shortcut>|list|next|prev|reload|save|restore|reset|export');
  });
});
