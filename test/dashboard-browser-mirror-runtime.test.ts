import { describe, expect, test } from 'bun:test';

import { createDashboardBrowserMirrorRuntime } from '../src/dashboard/browser-mirror-runtime.js';

describe('createDashboardBrowserMirrorRuntime', () => {
  test('projects working browser and obsidian widgets', () => {
    const runtime = createDashboardBrowserMirrorRuntime();
    const workingWidget = { state: {} as Record<string, unknown> };
    const entries = [{ absPath: '/a' }, { absPath: '/b' }];

    runtime.projectWorkingBrowser(
      workingWidget,
      entries,
      1,
      3,
      new Set(['/b']),
      true,
      entry => `item:${entry.absPath}`,
      entry => `icon:${entry.absPath}`,
    );

    expect(workingWidget.state.items).toEqual(['item:/a', 'item:/b']);
    expect(workingWidget.state.icons).toEqual(['icon:/a', 'icon:/b']);
    expect(workingWidget.state.cursor).toBe(1);
    expect(workingWidget.state.offset).toBe(3);
    expect(Array.from(workingWidget.state.selected as Set<string>)).toEqual(['item:/b']);
    expect(workingWidget.state.focused).toBe(true);

    const obsidianWidget = { state: {} as Record<string, unknown> };
    runtime.projectObsidian(
      obsidianWidget,
      {
        available: false,
        root: '/vault',
        entries,
        cursor: 0,
        offset: 0,
        selected: new Set<string>(),
      },
      false,
      entry => `item:${entry.absPath}`,
      entry => `icon:${entry.absPath}`,
      text => `warn:${text}`,
      text => `muted:${text}`,
    );

    expect(obsidianWidget.state.items).toEqual([
      'warn:vault not found',
      'muted:/vault',
      'muted:set $OBSIDIAN_VAULT to point at your vault',
    ]);
    expect(obsidianWidget.state.icons).toEqual(['', '', '']);
    expect(obsidianWidget.state.cursor).toBe(0);
    expect(obsidianWidget.state.focused).toBe(false);
  });
});
