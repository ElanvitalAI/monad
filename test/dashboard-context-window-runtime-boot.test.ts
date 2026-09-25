import { describe, expect, test } from 'bun:test';

import {
  bootDashboardContextWindowRuntime,
  createDashboardWindowRegistrySnapshot,
} from '../src/dashboard/context-window-runtime-boot.js';

describe('createDashboardWindowRegistrySnapshot', () => {
  test('projects windows and panes into tool-runtime friendly shape', () => {
    const snapshot = createDashboardWindowRegistrySnapshot({
      list: () => [{
        id: 1,
        title: 'Main',
        focused: true,
        listPanes: () => [
          { id: 'p1', content: { kind: 'vw-preview', title: 'Preview' } },
        ],
      }],
      current: () => null,
    });
    expect(snapshot.list()).toEqual([{
      id: 1,
      title: 'Main',
      focused: true,
      listPanes: expect.any(Function),
    }]);
    expect(snapshot.list()[0]!.listPanes()).toEqual([
      { id: 'p1', content: { kind: 'vw-preview', title: 'Preview' } },
    ]);
    expect(snapshot.current()).toBeNull();
  });
});

describe('bootDashboardContextWindowRuntime', () => {
  // Surface-unification v2.2 V2.2-5 (2026-05-11) — `getScheduledJobs`
  // wire retired with the dashboard scheduler view + `context.jobs.list`
  // LLM tool.
  test('wires control and context runtime deps against the live registry', () => {
    let controlInstalled: { getWindowRegistry: () => unknown } | undefined;
    let contextInstalled:
      | {
        cwd: string;
        getWindowRegistry: () => ReturnType<typeof createDashboardWindowRegistrySnapshot>;
        getTerminalSessions: () => Array<{ id: string; title: string; state: string }>;
      }
      | undefined;
    const registry = {
      list: () => [],
      current: () => null,
    };

    bootDashboardContextWindowRuntime({
      setControlRuntimeDeps: (deps) => { controlInstalled = deps; },
      setContextRuntimeDeps: (deps) => { contextInstalled = deps; },
      registry,
      cwd: '/repo',
      getTerminalSessions: () => [{ id: 's1', title: 'Term', state: 'running' }],
    });

    expect(controlInstalled?.getWindowRegistry()).toBe(registry);
    expect(contextInstalled?.cwd).toBe('/repo');
    expect(contextInstalled?.getTerminalSessions()).toEqual([{ id: 's1', title: 'Term', state: 'running' }]);
    expect(contextInstalled?.getWindowRegistry().list()).toEqual([]);
  });
});
