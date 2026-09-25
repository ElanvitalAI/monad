import { describe, expect, test } from 'bun:test';

import {
  resolveDashboardInitialWorkingFocus,
  resolveFocusToInputTransition,
  resolveFocusToPaneTransition,
  resolveInputExitRestoreTransition,
  resolvePaneEnterInputTransition,
} from '../src/dashboard/input/focus-transition.js';

describe('dashboard focus transitions', () => {
  test('boot focus starts in input', () => {
    expect(resolveDashboardInitialWorkingFocus()).toBe('input');
  });

  test('pane enter input remembers source pane and mode', () => {
    expect(resolvePaneEnterInputTransition('browser')).toEqual({
      nextFocus: 'input',
      nextPendingInputEntryMode: null,
      nextLastWorkingDirPane: 'browser',
      reason: 'pane-enter-input',
    });
    expect(resolvePaneEnterInputTransition('preview', {
      mode: 'slash',
      reason: 'pane-slash-open-input',
    })).toEqual({
      nextFocus: 'input',
      nextPendingInputEntryMode: 'slash',
      nextLastWorkingDirPane: 'preview',
      reason: 'pane-slash-open-input',
    });
  });

  test('generic focus to input can preserve or skip pane-restore memory', () => {
    expect(resolveFocusToInputTransition({
      sourcePane: 'scratch',
      rememberPane: true,
      reason: 'scratch-preview-enter',
    })).toEqual({
      nextFocus: 'input',
      nextPendingInputEntryMode: null,
      nextLastWorkingDirPane: 'scratch',
      reason: 'scratch-preview-enter',
    });
    expect(resolveFocusToInputTransition({
      sourcePane: 'browser',
      rememberPane: false,
      mode: 'plain',
      reason: 'non-restoring-open-input',
    })).toEqual({
      nextFocus: 'input',
      nextPendingInputEntryMode: 'plain',
      nextLastWorkingDirPane: null,
      reason: 'non-restoring-open-input',
    });
  });

  test('generic focus to pane can preserve or skip pane-restore memory', () => {
    expect(resolveFocusToPaneTransition({
      targetPane: 'log',
      reason: 'ctrl-g-global',
    })).toEqual({
      nextFocus: 'log',
      nextLastWorkingDirPane: 'log',
      reason: 'ctrl-g-global',
    });
    expect(resolveFocusToPaneTransition({
      targetPane: 'browser',
      rememberPane: false,
      reason: 'temporary-pane-jump',
    })).toEqual({
      nextFocus: 'browser',
      nextLastWorkingDirPane: null,
      reason: 'temporary-pane-jump',
    });
  });

  test('input exit restores prior pane when chat-main owned the foreground', () => {
    expect(resolveInputExitRestoreTransition({
      inputOwner: 'chat-main',
      pluginActive: false,
      autoInputArmed: false,
      inputExited: true,
      lastWorkingDirPane: 'obsidian',
      fallbackPane: 'browser',
    })).toEqual({
      nextFocus: 'obsidian',
      reason: 'input-exit-restore-pane',
    });
  });

  test('input exit falls back to default pane when no prior pane is remembered', () => {
    expect(resolveInputExitRestoreTransition({
      inputOwner: 'chat-main',
      pluginActive: false,
      autoInputArmed: true,
      inputExited: false,
      lastWorkingDirPane: null,
      fallbackPane: 'browser',
    })).toEqual({
      nextFocus: 'browser',
      reason: 'input-exit-restore-pane',
    });
  });

  test('input exit stays put when foreground ownership or trigger is missing', () => {
    expect(resolveInputExitRestoreTransition({
      inputOwner: 'vw-local-composer',
      pluginActive: false,
      autoInputArmed: true,
      inputExited: true,
      lastWorkingDirPane: 'browser',
      fallbackPane: 'preview',
    })).toBeNull();
    expect(resolveInputExitRestoreTransition({
      inputOwner: 'chat-main',
      pluginActive: true,
      autoInputArmed: true,
      inputExited: true,
      lastWorkingDirPane: 'browser',
      fallbackPane: 'preview',
    })).toBeNull();
    expect(resolveInputExitRestoreTransition({
      inputOwner: 'chat-main',
      pluginActive: false,
      autoInputArmed: false,
      inputExited: false,
      lastWorkingDirPane: 'browser',
      fallbackPane: 'preview',
    })).toBeNull();
  });
});
