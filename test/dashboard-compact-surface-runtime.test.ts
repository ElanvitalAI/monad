import { describe, expect, test } from 'bun:test';
import { createCompactSurfaceRuntime } from '../src/dashboard/compact-surface-runtime.js';

describe('createCompactSurfaceRuntime', () => {
  test('builds compact-aware catalog targets', () => {
    const runtime = createCompactSurfaceRuntime({
      getClosedPanes: () => [{ pane: 'browser', label: 'Browser' }],
      getActiveViewLabel: () => 'Normal',
      getCompactMode: () => 'compact-tight',
      openDashboardPane: () => true,
      focusPane: () => {},
      openBrowserPreviewModal: () => {},
      openDashboardPaneModal: () => {},
      openCompanionPopup: () => {},
      spawnBrowserVirtualWindow: () => {},
      spawnPreviewVirtualWindow: () => {},
      spawnBrowserPreviewVirtualWindow: () => {},
      spawnScratchVirtualWindow: () => {},
      spawnSimVirtualWindow: () => {},
      currentVirtualWindowId: () => null,
      openVwCompanion: () => {},
    });

    expect(runtime.buildTargets().map((item) => item.id)).toEqual([
      'reopen:browser',
      'pane:browser-preview',
      'pane:browser',
      'pane:preview',
      'pane:obsidian',
      'companion:clipboard',
      'companion:memo',
      'companion:detail',
      'vw:browser-preview',
      'vw:sim',
      'vw:browser',
      'vw:preview',
    ]);
  });

  test('routes surface ids through the shared dispatch contract', () => {
    const calls: string[] = [];
    const runtime = createCompactSurfaceRuntime({
      getClosedPanes: () => [],
      getActiveViewLabel: () => 'Normal',
      getCompactMode: () => 'wide',
      openDashboardPane: (pane) => {
        calls.push(`reopen:${pane}`);
        return true;
      },
      focusPane: (pane) => calls.push(`focus:${pane}`),
      openBrowserPreviewModal: () => calls.push('pane:browser-preview'),
      openDashboardPaneModal: (pane) => calls.push(`pane:${pane}`),
      openCompanionPopup: (key) => calls.push(`companion:${key}`),
      spawnBrowserVirtualWindow: () => calls.push('vw:browser'),
      spawnPreviewVirtualWindow: () => calls.push('vw:preview'),
      spawnBrowserPreviewVirtualWindow: () => calls.push('vw:browser-preview'),
      spawnScratchVirtualWindow: () => calls.push('vw:scratch'),
      spawnSimVirtualWindow: () => calls.push('vw:sim'),
      currentVirtualWindowId: () => 7,
      openVwCompanion: (windowId, key) => calls.push(`vw-companion:${windowId}:${key}`),
      onWarning: (message) => calls.push(`warn:${message}`),
    });

    runtime.openTarget('reopen:browser');
    runtime.openTarget('companion:memo');
    runtime.openTarget('vw-companion:detail');
    runtime.openTarget('vw:sim');
    runtime.openTarget('vw:preview');

    expect(calls).toEqual([
      'reopen:browser',
      'focus:browser',
      'companion:memo',
      'vw-companion:7:detail',
      'vw:sim',
      'vw:preview',
    ]);
  });
});
