import { describe, expect, test } from 'bun:test';

import { createDashboardWindowSlashRuntime } from '../src/dashboard/window-slash-runtime.js';

describe('createDashboardWindowSlashRuntime', () => {
  test('builds help and list lines', () => {
    const runtime = createDashboardWindowSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
      error: (text) => `error:${text}`,
      warning: (text) => `warning:${text}`,
    });

    const help = runtime.helpLines();
    const list = runtime.listLines([
      { id: 7, title: 'main', paneCount: 2, isCurrent: true },
      { id: 8, title: 'bg', paneCount: 1, isCurrent: false },
    ]);
    const empty = runtime.listLines([]);

    expect(help[1]).toBe('accent:❯ /workspace');
    expect(help.some((line) => line.includes('/workspace list'))).toBe(true);
    expect(help.some((line) => line.includes('/workspace iul'))).toBe(true);
    expect(help.some((line) => line.includes('/workspace acp'))).toBe(true);
    expect(help.some((line) => line.includes('/workspace sim'))).toBe(true);
    expect(list).toEqual([
      '  success:fg  win:7  main  (2 panes)',
      '  muted:bg  win:8  bg  (1 pane)',
    ]);
    expect(empty).toEqual([
      'muted:  No workspaces. Use /workspace new or the WindowCreate tool.',
    ]);
    expect(runtime.spawnedLine('browser-preview', 9, 'bp')).toBe(
      'muted:  spawned win:9 "bp" (browser + preview panes)',
    );
    expect(runtime.spawnedLine('iul', 10, 'IUL UX Lab')).toBe(
      'muted:  spawned win:10 "IUL UX Lab" (IUL UX Lab shell)',
    );
    expect(runtime.spawnedLine('acp', 11, 'ACP channels')).toBe(
      'muted:  spawned win:11 "ACP channels" (ACP channel browser)',
    );
    expect(runtime.spawnedLine('sim', 12, 'Simulator')).toBe(
      'muted:  spawned win:12 "Simulator" (simulation shell)',
    );
    expect(runtime.spawnFailedLine('browser', 'boom')).toBe(
      'error:  /workspace browser failed: boom',
    );
    expect(runtime.spawnFailedLine('iul', 'boom')).toBe(
      'error:  /workspace iul failed: boom',
    );
    expect(runtime.spawnFailedLine('acp', 'boom')).toBe(
      'error:  /workspace acp failed: boom',
    );
    expect(runtime.spawnFailedLine('sim', 'boom')).toBe(
      'error:  /workspace sim failed: boom',
    );
    expect(runtime.switchInvalidIdLine()).toBe(
      'warning:  /workspace switch <id> — integer id required. Run /workspace list.',
    );
    expect(runtime.switchMissingLine(4)).toBe('warning:  no window with id 4');
    expect(runtime.switchedLine(4)).toBe('muted:  switched to win:4');
    expect(runtime.closeAllLine(2)).toBe('muted:  closed 2 windows');
    expect(runtime.closeInvalidLine()).toBe(
      'warning:  /workspace close <id|all> — integer id or "all" required.',
    );
    expect(runtime.closeMissingLine(5)).toBe('warning:  no window with id 5');
    expect(runtime.closedLine(5)).toBe('muted:  closed win:5');
    expect(runtime.companionLine('toggle', true, 'memo', 7)).toBe(
      'muted:  opened memo companion for win:7',
    );
    expect(runtime.companionLine('close', false, 'memo', 7)).toBe(
      'muted:  closed memo companion for win:7',
    );
    expect(runtime.unknownSubcommandLine('zzz')).toBe(
      'warning:  Unknown /workspace subcommand: zzz. Try /workspace help.',
    );
  });
});
