import { describe, expect, test } from 'bun:test';

import {
  resolveDashboardSubmitAction,
  runDashboardSubmitAction,
} from '../src/dashboard/input/submit-actions.js';

describe('dashboard submit actions', () => {
  test('resolves dashboard submit text into semantic actions', () => {
    expect(resolveDashboardSubmitAction('wd-cd:/tmp/demo')).toEqual({
      kind: 'change-working-dir',
      absPath: '/tmp/demo',
    });
    expect(resolveDashboardSubmitAction('wd-cd:@wd-browser:/tmp/demo')).toEqual({
      kind: 'change-working-dir',
      browserId: 'wd-browser',
      absPath: '/tmp/demo',
    });
    expect(resolveDashboardSubmitAction('file-attach:/tmp/demo.txt')).toEqual({
      kind: 'attach-file',
      absPath: '/tmp/demo.txt',
    });
    expect(resolveDashboardSubmitAction('file-attach:@wd-working-browser:/tmp/demo.txt')).toEqual({
      kind: 'attach-file',
      browserId: 'wd-working-browser',
      absPath: '/tmp/demo.txt',
    });
    expect(resolveDashboardSubmitAction('folder-attach:/tmp/demo')).toEqual({
      kind: 'attach-folder',
      absPath: '/tmp/demo',
    });
    expect(resolveDashboardSubmitAction('toolbelt:status:agent:42')).toEqual({
      kind: 'toolbelt-action',
      action: 'status',
      sessionId: 'agent:42',
    });
    expect(resolveDashboardSubmitAction('session:abc')).toEqual({
      kind: 'select-session',
      sessionId: 'abc',
    });
    expect(resolveDashboardSubmitAction('plain log line')).toEqual({
      kind: 'log-text',
      text: 'plain log line',
    });
  });

  test('dispatcher routes each action to the matching effect', () => {
    const calls: string[] = [];
    runDashboardSubmitAction(
      { kind: 'attach-folder', absPath: '/tmp/folder', browserId: 'wd-browser' },
      {
        onChangeWorkingDir: (absPath, browserId) => calls.push(`cd:${browserId ?? '-'}:${absPath}`),
        onAttachFile: (absPath, browserId) => calls.push(`file:${browserId ?? '-'}:${absPath}`),
        onAttachFolder: (absPath, browserId) => calls.push(`folder:${browserId ?? '-'}:${absPath}`),
        onToolbeltAction: (action, sessionId) => calls.push(`toolbelt:${action}:${sessionId}`),
        onSelectSession: sessionId => calls.push(`session:${sessionId}`),
        onLogText: text => calls.push(`log:${text}`),
      },
    );
    expect(calls).toEqual(['folder:wd-browser:/tmp/folder']);
  });
});
