import { afterEach, describe, expect, test } from 'bun:test';

import { dispatchSessionRuntimeTool } from '../src/session-runtime/index.js';
import {
  _resetToolRuntimeRegistryForTest,
  dispatchToolByName,
  getToolRuntime,
  registerAllDefaultToolRuntimes,
} from '../src/tool-runtime/index.js';
import {
  PTY_RUNTIMES,
  setPtyRuntimeDispatchersForTest,
} from '../src/tool-runtime/pty-runtimes.js';

const names = ['PtyShellStart', 'PtyShellPoll', 'PtyShellSend', 'PtyShellKill', 'PtyShellList'] as const;

let restoreDispatchers: (() => void) | undefined;

afterEach(() => {
  restoreDispatchers?.();
  restoreDispatchers = undefined;
  _resetToolRuntimeRegistryForTest();
});

describe('dashboard PtyShell runtime dispatch', () => {
  test('registers every PtyShell runtime and dispatches each through its real run() wrapper', async () => {
    const calls: string[] = [];
    restoreDispatchers = setPtyRuntimeDispatchersForTest({
      start: async () => { calls.push('PtyShellStart'); return { output: 'start' }; },
      poll: async () => { calls.push('PtyShellPoll'); return { output: 'poll' }; },
      send: async () => { calls.push('PtyShellSend'); return { output: 'send', submitNormalized: false }; },
      kill: async () => { calls.push('PtyShellKill'); return { output: 'kill' }; },
      list: () => { calls.push('PtyShellList'); return { output: 'list' }; },
    });
    registerAllDefaultToolRuntimes();

    expect(PTY_RUNTIMES.map(runtime => runtime.spec.name)).toEqual([...names]);
    for (const name of names) {
      expect(getToolRuntime(name)).toBe(PTY_RUNTIMES.find(runtime => runtime.spec.name === name));
      const result = await dispatchSessionRuntimeTool(name, {}, {
        ptyDashboardOn: true,
        getToolRuntime: (candidate) => getToolRuntime(candidate) as any,
        dispatchToolRuntime: async (candidate, args) => await dispatchToolByName(candidate, args, { surface: 'dashboard' }),
        dispatchPluginTool: async () => ({ ok: false, error: 'unexpected plugin fallback' }),
      });
      expect(result).toMatchObject({ output: name.replace('PtyShell', '').toLowerCase() });
    }

    expect(calls).toEqual([...names]);
  });
});
