import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainLogCommand } from '../src/dashboard/input/chat-main-log-command.js';

describe('dashboard chat main log command', () => {
  test('defaults to help when subcommand is omitted', () => {
    expect(resolveDashboardChatMainLogCommand([])).toEqual({ kind: 'help' });
  });

  test('normalizes size/filter/search/turn payloads', () => {
    expect(resolveDashboardChatMainLogCommand(['size', '+3'])).toEqual({ kind: 'size', delta: '+3' });
    expect(resolveDashboardChatMainLogCommand(['filter', 'error', 'rows'])).toEqual({ kind: 'filter', query: 'error rows' });
    expect(resolveDashboardChatMainLogCommand(['search', 'needle'])).toEqual({ kind: 'search', query: 'needle' });
    expect(resolveDashboardChatMainLogCommand(['turn', 'BoTh'])).toEqual({ kind: 'turn', arg: 'both' });
  });

  test('coalesces solo, whole-copy, and return-to-input aliases while preserving unknowns', () => {
    expect(resolveDashboardChatMainLogCommand(['zoom'])).toEqual({ kind: 'solo' });
    expect(resolveDashboardChatMainLogCommand(['COPY'])).toEqual({ kind: 'copy-all' });
    expect(resolveDashboardChatMainLogCommand(['all'])).toEqual({ kind: 'copy-all' });
    expect(resolveDashboardChatMainLogCommand(['input'])).toEqual({ kind: 'return-to-input' });
    expect(resolveDashboardChatMainLogCommand(['return'])).toEqual({ kind: 'return-to-input' });
    expect(resolveDashboardChatMainLogCommand(['mystery'])).toEqual({ kind: 'unknown', subcommand: 'mystery' });
  });
});
