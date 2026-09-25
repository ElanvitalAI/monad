import { describe, expect, test } from 'bun:test';

import {
  cleanupDashboardInputLoopExit,
  restoreDashboardInputExit,
} from '../src/dashboard/input-exit-runtime.js';

describe('cleanupDashboardInputLoopExit', () => {
  test('clears stale prompt hooks and marks input exited', () => {
    const calls: string[] = [];
    cleanupDashboardInputLoopExit({
      clearPromptRepaint: () => { calls.push('repaint'); },
      detachInsertAtCursor: () => { calls.push('insert'); },
      clearDisplayCursor: () => { calls.push('cursor'); },
      markInputExited: () => { calls.push('exited'); },
    });
    expect(calls).toEqual(['repaint', 'insert', 'cursor', 'exited']);
  });
});

describe('restoreDashboardInputExit', () => {
  test('applies pane restore when foreground input just exited', () => {
    const calls: string[] = [];
    const restored = restoreDashboardInputExit({
      inputOwner: 'chat-main',
      pluginActive: false,
      autoInputArmed: false,
      inputExited: true,
      lastWorkingDirPane: 'browser',
      fallbackPane: 'logs',
      applyTransition: (nextFocus, reason) => {
        calls.push(`focus:${nextFocus}:${reason}`);
      },
      clearLastWorkingDirPane: () => { calls.push('clear-last-pane'); },
    });
    expect(restored).toBe(true);
    expect(calls).toEqual([
      'focus:browser:input-exit-restore-pane',
      'clear-last-pane',
    ]);
  });

  test('no-ops when restore policy does not fire', () => {
    const calls: string[] = [];
    const restored = restoreDashboardInputExit({
      inputOwner: 'vw-local-composer',
      pluginActive: false,
      autoInputArmed: false,
      inputExited: true,
      lastWorkingDirPane: 'browser',
      fallbackPane: 'logs',
      applyTransition: () => { calls.push('focus'); },
      clearLastWorkingDirPane: () => { calls.push('clear'); },
    });
    expect(restored).toBe(false);
    expect(calls).toEqual([]);
  });
});
