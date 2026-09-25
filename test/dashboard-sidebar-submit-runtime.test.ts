import { describe, expect, test } from 'bun:test';

import { createDashboardSidebarSubmitRuntime } from '../src/dashboard/sidebar-submit-runtime.js';

describe('createDashboardSidebarSubmitRuntime', () => {
  test('routes ACP session selection through join runner and plain sessions through muted line', () => {
    const events: string[] = [];
    const runtime = createDashboardSidebarSubmitRuntime({
      onChangeWorkingDir: () => {},
      onAttachFile: () => {},
      onAttachFolder: () => {},
      getStatusRecord: () => null,
      attachBlock: () => ({ kind: 'no-block' }),
      markSessionRead: (sessionId) => { events.push(`read:${sessionId}`); },
      refreshSessionCards: () => { events.push('refresh'); },
      getBackgroundSessionState: () => 'running',
      terminalBackgroundStates: ['completed', 'failed'],
      runSessionJoin: (sessionId, promoteToVW) => { events.push(`join:${sessionId}:${promoteToVW}`); },
      pushMutedLine: (line) => { events.push(`muted:${line}`); },
      pushInfoLine: (line) => { events.push(`info:${line}`); },
      pushLogText: (line) => { events.push(`log:${line}`); },
    });

    runtime.onSelectSession('acp-bg:1');
    runtime.onSelectSession('agent-1');

    expect(events).toEqual([
      'read:acp-bg:1',
      'refresh',
      'join:acp-bg:1:true',
      'read:agent-1',
      'refresh',
      'muted:[sidebar] selected agent-1 (focus hop TBD).',
    ]);
  });

  test('routes toolbelt and log text through the provided sinks', () => {
    const events: string[] = [];
    const runtime = createDashboardSidebarSubmitRuntime({
      onChangeWorkingDir: () => {},
      onAttachFile: () => {},
      onAttachFolder: () => {},
      getStatusRecord: () => null,
      attachBlock: () => ({ kind: 'no-block' }),
      markSessionRead: () => {},
      refreshSessionCards: () => {},
      getBackgroundSessionState: () => null,
      terminalBackgroundStates: [],
      runSessionJoin: () => {},
      pushMutedLine: (line) => { events.push(`muted:${line}`); },
      pushInfoLine: (line) => { events.push(`info:${line}`); },
      pushLogText: (line) => { events.push(`log:${line}`); },
    });

    runtime.onToolbeltAction('review', 's1');
    runtime.onLogText('hello');

    expect(events).toEqual([
      'muted:[toolbelt] review — coming soon (future session).',
      'log:hello',
    ]);
  });
});
