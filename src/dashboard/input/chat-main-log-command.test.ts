import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainLogCommand } from './chat-main-log-command.js';

describe('resolveDashboardChatMainLogCommand', () => {
  test('recognizes /log fold with optional mode argument', () => {
    expect(resolveDashboardChatMainLogCommand(['fold'])).toEqual({
      kind: 'fold',
      mode: '',
    });
    expect(resolveDashboardChatMainLogCommand(['fold', 'line'])).toEqual({
      kind: 'fold',
      mode: 'line',
    });
    expect(resolveDashboardChatMainLogCommand(['FOLD', 'TASK-UNIT'])).toEqual({
      kind: 'fold',
      mode: 'task-unit',
    });
    expect(resolveDashboardChatMainLogCommand(['fold', 'KIND-UNIT'])).toEqual({
      kind: 'fold',
      mode: 'kind-unit',
    });
  });

  test('preserves existing /log subcommand meanings', () => {
    expect(resolveDashboardChatMainLogCommand([])).toEqual({ kind: 'help' });
    expect(resolveDashboardChatMainLogCommand(['size', '+2'])).toEqual({ kind: 'size', delta: '+2' });
    expect(resolveDashboardChatMainLogCommand(['clear'])).toEqual({ kind: 'clear' });
    expect(resolveDashboardChatMainLogCommand(['filter', 'agent', 'done'])).toEqual({ kind: 'filter', query: 'agent done' });
    expect(resolveDashboardChatMainLogCommand(['search', 'needle'])).toEqual({ kind: 'search', query: 'needle' });
    expect(resolveDashboardChatMainLogCommand(['freeze'])).toEqual({ kind: 'freeze' });
    expect(resolveDashboardChatMainLogCommand(['zoom'])).toEqual({ kind: 'solo' });
    expect(resolveDashboardChatMainLogCommand(['turn', 'BOTH'])).toEqual({ kind: 'turn', arg: 'both' });
    expect(resolveDashboardChatMainLogCommand(['copy'])).toEqual({ kind: 'copy-all' });
    expect(resolveDashboardChatMainLogCommand(['return'])).toEqual({ kind: 'return-to-input' });
    expect(resolveDashboardChatMainLogCommand(['wat'])).toEqual({ kind: 'unknown', subcommand: 'wat' });
  });
});
