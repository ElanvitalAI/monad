// Surface-unification v2.2 V2.2-5 (2026-05-11) — `listSchedulerJobs` /
// `mapSchedulerJob` deps removed together with the `context.jobs.list`
// LLM tool retirement. Tests reduced to the remaining wires.

import { describe, expect, test } from 'bun:test';

import { bootDashboardContextRuntime } from '../src/dashboard/context-runtime-boot.js';

describe('bootDashboardContextRuntime', () => {
  test('wires cwd + terminal sessions getter', () => {
    let installed:
      | {
        cwd: string;
        getTerminalSessions: () => Array<{ id: string; title: string; state: string }>;
      }
      | undefined;

    bootDashboardContextRuntime({
      setContextRuntimeDeps: (deps) => { installed = deps; },
      cwd: '/repo',
      listTerminalSessions: () => [{ id: 's1', title: 'Term 1', state: 'running' }],
      mapTerminalSession: (session) => session,
    });

    expect(installed?.cwd).toBe('/repo');
    expect(installed?.getTerminalSessions()).toEqual([{ id: 's1', title: 'Term 1', state: 'running' }]);
  });

  test('terminal getter failure degrades to empty array', () => {
    let installed:
      | {
        getTerminalSessions: () => Array<{ id: string; title: string; state: string }>;
      }
      | undefined;

    bootDashboardContextRuntime({
      setContextRuntimeDeps: (deps) => { installed = deps; },
      cwd: '/repo',
      listTerminalSessions: () => { throw new Error('boom'); },
      mapTerminalSession: (session: never) => session,
    });

    expect(installed?.getTerminalSessions()).toEqual([]);
  });
});
