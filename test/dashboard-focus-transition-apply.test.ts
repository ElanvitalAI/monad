import { describe, expect, test } from 'bun:test';

import {
  applyFocusToInputTransition,
  applyFocusToPaneTransition,
  applyInputExitRestoreTransition,
  type DashboardFocusTransitionApplyHost,
} from '../src/dashboard/input/focus-transition-apply.js';

describe('dashboard focus transition apply helpers', () => {
  test('input transition updates pane memory, entry mode, and focus in order', () => {
    const calls: string[] = [];
    const host: DashboardFocusTransitionApplyHost = {
      setWorkingFocus: (next, reason) => calls.push(`focus:${next}:${reason}`),
      setLastWorkingDirPane: (next) => calls.push(`last:${String(next)}`),
      setPendingInputEntryMode: (next) => calls.push(`mode:${String(next)}`),
    };

    applyFocusToInputTransition(host, {
      nextFocus: 'input',
      nextPendingInputEntryMode: 'slash',
      nextLastWorkingDirPane: 'browser',
      reason: 'pane-slash-open-input',
    });

    expect(calls).toEqual([
      'last:browser',
      'mode:slash',
      'focus:input:pane-slash-open-input',
    ]);
  });

  test('input exit restore clears remembered pane after focus restore', () => {
    const calls: string[] = [];
    const host: DashboardFocusTransitionApplyHost = {
      setWorkingFocus: (next, reason) => calls.push(`focus:${next}:${reason}`),
      setLastWorkingDirPane: (next) => calls.push(`last:${String(next)}`),
      setPendingInputEntryMode: () => calls.push('mode:ignored'),
    };

    applyInputExitRestoreTransition(host, {
      nextFocus: 'preview',
      reason: 'input-exit-restore-pane',
    });

    expect(calls).toEqual([
      'focus:preview:input-exit-restore-pane',
      'last:null',
    ]);
  });

  test('pane transition updates focus and remembered pane', () => {
    const calls: string[] = [];
    const host: DashboardFocusTransitionApplyHost = {
      setWorkingFocus: (next, reason) => calls.push(`focus:${next}:${reason}`),
      setLastWorkingDirPane: (next) => calls.push(`last:${String(next)}`),
      setPendingInputEntryMode: () => calls.push('mode:ignored'),
    };

    applyFocusToPaneTransition(host, {
      nextFocus: 'log',
      nextLastWorkingDirPane: 'log',
      reason: 'goto-log',
    });

    expect(calls).toEqual([
      'focus:log:goto-log',
      'last:log',
    ]);
  });
});
