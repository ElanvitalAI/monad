import { describe, expect, test } from 'bun:test';

import { handleDashboardSidebarWorkingDirChange } from '../src/dashboard/sidebar-working-dir-change.js';

describe('handleDashboardSidebarWorkingDirChange', () => {
  test('handles local browser directory changes', () => {
    const events: string[] = [];
    const browser = { cwd: '/tmp/next' };

    handleDashboardSidebarWorkingDirChange('/tmp/next', 'browser-1', {
      workingDir: {},
      resolveTargetBrowser: () => browser,
      enterRemoteDirectory: () => { events.push('remote-enter'); },
      refreshRemoteWorkingDir: async () => { events.push('remote-refresh'); },
      refreshRemotePreviewBridge: async () => { events.push('remote-preview'); },
      enterDirectory: (_target, absPath) => { events.push(`enter:${absPath}`); },
      refreshWorkingDir: (target) => { events.push(`refresh:${target.cwd}`); },
      refreshWorkingDirPreview: () => { events.push('preview'); },
      onLogLine: (line) => { events.push(`log:${line}`); },
      onAfterChange: () => { events.push('after'); },
    });

    expect(events).toEqual([
      'enter:/tmp/next',
      'refresh:/tmp/next',
      'preview',
      'log:cd /tmp/next',
      'after',
    ]);
  });

  test('handles remote browser directory changes', async () => {
    const events: string[] = [];
    const workingDir = { remote: { host: { name: 'mbp' } } };

    handleDashboardSidebarWorkingDirChange('/srv/app', null, {
      workingDir,
      resolveTargetBrowser: () => ({ cwd: '/unused' }),
      enterRemoteDirectory: (_workingDir, absPath) => { events.push(`remote-enter:${absPath}`); },
      refreshRemoteWorkingDir: async () => { events.push('remote-refresh'); },
      refreshRemotePreviewBridge: async () => { events.push('remote-preview'); },
      enterDirectory: () => { events.push('local-enter'); },
      refreshWorkingDir: () => { events.push('local-refresh'); },
      refreshWorkingDirPreview: () => { events.push('local-preview'); },
      onLogLine: (line) => { events.push(`log:${line}`); },
      onAfterChange: () => { events.push('after'); },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'remote-enter:/srv/app',
      'remote-refresh',
      'log:cd mbp:/srv/app',
      'after',
      'remote-preview',
      'after',
    ]);
  });
});
