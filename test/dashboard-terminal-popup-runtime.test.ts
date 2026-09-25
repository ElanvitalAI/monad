import { describe, expect, test } from 'bun:test';

import { createDashboardTerminalPopupRuntime } from '../src/dashboard/terminal-popup-runtime.js';

describe('createDashboardTerminalPopupRuntime', () => {
  test('warns when popup opens without cwd', () => {
    const calls: string[] = [];
    const runtime = createDashboardTerminalPopupRuntime({
      onMissingCwd: () => { calls.push('missing'); },
      openInteractiveTerminalPopup: () => {
        calls.push('open');
        return null;
      },
    });
    expect(runtime.shell().open()).toBeNull();
    expect(calls).toEqual(['missing']);
  });

  test('opens shell and agent requests with the expected shape', () => {
    const requests: unknown[] = [];
    const runtime = createDashboardTerminalPopupRuntime({
      onMissingCwd: () => {},
      openInteractiveTerminalPopup: (req) => {
        requests.push(req);
        return null;
      },
    });
    runtime.shell().cwd('/tmp').command('ls').env({ A: '1' }).open();
    runtime.agent('codex').cwd('/repo').args(['--x']).open();
    runtime.spawnGlobalTerminalModal('/cwd');
    expect(requests).toEqual([
      { kind: 'shell', cwd: '/tmp', command: 'ls', env: { A: '1' } },
      { kind: 'coding-agent', brand: 'codex', cwd: '/repo', extraArgs: ['--x'] },
      { kind: 'shell', cwd: '/cwd', command: undefined, env: undefined },
    ]);
  });
});
