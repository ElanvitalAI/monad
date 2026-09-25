import { describe, expect, test } from 'bun:test';

import {
  dashboardLogHelpLines,
  resolveDashboardLogFilterAction,
  resolveDashboardLogSearchAction,
  resolveDashboardLogSizeAction,
  resolveDashboardLogTurnAction,
} from '../src/dashboard/input/chat-main-log-actions.js';

describe('dashboard chat main log actions', () => {
  test('returns stable help text for /log discoverability', () => {
    const lines = dashboardLogHelpLines();
    expect(lines[0]).toBe('\u276f /log');
    expect(lines).toContain('  /log turn <off|rule|time|both|now>  Insert/toggle between-turn separator (rule + optional clock).');
    expect(lines).toContain('  /log copy                   Copy the entire log (same as Alt+A).');
    expect(lines).toContain('  /log input                  Return focus to the input (same as Alt+U).');
    expect(lines).toContain('  Alt+G/Y/F  Copy last message / code / media');
    expect(lines.at(-1)).toBe('  Ctrl+\u2191/\u2193 (anywhere) also resizes; Ctrl+0 resets.');
  });

  test('resolves turn actions for now, explicit modes, and status fallback', () => {
    expect(resolveDashboardLogTurnAction('now', 'off')).toEqual({
      kind: 'emit-now',
      nextModeWhileEmitting: 'both',
    });
    expect(resolveDashboardLogTurnAction('rule', 'off')).toEqual({
      kind: 'set-mode',
      mode: 'rule',
      message: '  log turn separator → rule',
    });
    expect(resolveDashboardLogTurnAction('on', 'time')).toEqual({
      kind: 'set-mode',
      mode: 'both',
      message: '  log turn separator → both (rule + timestamp)',
    });
    expect(resolveDashboardLogTurnAction('', 'time')).toEqual({
      kind: 'show-status',
      message: '  current turn separator: time',
      usage: '  /log turn off | rule | time | both | on | now',
    });
  });

  test('resolves size actions for reset, invalid input, and bias changes', () => {
    expect(resolveDashboardLogSizeAction('', 3)).toEqual({
      kind: 'reset',
      nextBias: 0,
      message: '  log height bias reset → 0 (current: 0)',
    });
    expect(resolveDashboardLogSizeAction('bad', 3)).toEqual({
      kind: 'invalid',
      message: '  /log size expects +N, -N, =N, or "reset". Try /log help.',
    });
    expect(resolveDashboardLogSizeAction('+2', 3)).toEqual({
      kind: 'set',
      nextBias: 5,
      message: '  log height bias → 5',
    });
  });

  test('resolves filter and search actions', () => {
    expect(resolveDashboardLogFilterAction('clear', 'abc', 4)).toEqual({
      kind: 'clear',
      message: '  log filter cleared.',
    });
    expect(resolveDashboardLogFilterAction('', 'abc', 4)).toEqual({
      kind: 'show-status',
      message: '  current log filter: "abc" (4 rows)',
    });
    expect(resolveDashboardLogFilterAction('error', '', 2)).toEqual({
      kind: 'apply',
      query: 'error',
      message: '  log filter "error" → 2 visible rows',
    });

    expect(resolveDashboardLogSearchAction('clear')).toEqual({
      kind: 'clear',
      message: '  log search cleared.',
    });
    expect(resolveDashboardLogSearchAction('')).toEqual({
      kind: 'open-modal',
    });
    expect(resolveDashboardLogSearchAction('needle')).toEqual({
      kind: 'apply',
      query: 'needle',
    });
  });
});
