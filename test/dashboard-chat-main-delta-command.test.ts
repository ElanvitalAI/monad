import { describe, expect, test } from 'bun:test';

import {
  dashboardDeltaHelpLines,
  parseDashboardDeltaBrowserMode,
  resolveDashboardChatMainDeltaCommand,
} from '../src/dashboard/input/chat-main-delta-command.js';

describe('dashboard chat main delta command', () => {
  test('parses browser modes', () => {
    expect(parseDashboardDeltaBrowserMode('all')).toBe('all');
    expect(parseDashboardDeltaBrowserMode('files')).toBe('files');
    expect(parseDashboardDeltaBrowserMode('turns')).toBe('turns');
    expect(parseDashboardDeltaBrowserMode('weird')).toBeUndefined();
  });

  test('parses help and open aliases', () => {
    expect(resolveDashboardChatMainDeltaCommand(['help'])).toEqual({ kind: 'help' });
    expect(resolveDashboardChatMainDeltaCommand([])).toEqual({
      kind: 'open',
      scope: 'recent',
      browserMode: undefined,
    });
    expect(resolveDashboardChatMainDeltaCommand(['show', 'files'])).toEqual({
      kind: 'open',
      scope: 'recent',
      browserMode: 'files',
    });
  });

  test('parses latest and recent variants', () => {
    expect(resolveDashboardChatMainDeltaCommand(['latest', 'turns'])).toEqual({
      kind: 'open',
      scope: 'latest',
      browserMode: 'turns',
    });
    expect(resolveDashboardChatMainDeltaCommand(['recent', '7', 'all'])).toEqual({
      kind: 'open',
      scope: 'recent',
      limit: 7,
      browserMode: 'all',
    });
    expect(resolveDashboardChatMainDeltaCommand(['recent', 'files'])).toEqual({
      kind: 'open',
      scope: 'recent',
      limit: undefined,
      browserMode: 'files',
    });
  });

  test('parses flat mode aliases and unknown subcommands', () => {
    expect(resolveDashboardChatMainDeltaCommand(['files'])).toEqual({
      kind: 'open',
      scope: 'recent',
      browserMode: 'files',
    });
    expect(resolveDashboardChatMainDeltaCommand(['wat'])).toEqual({
      kind: 'unknown',
      subcommand: 'wat',
    });
  });

  test('renders help lines with defaults', () => {
    expect(dashboardDeltaHelpLines(12, 'files')).toContain(
      '  Default recent depth comes from chat.rendering.diff.turnBrowserHistory (12).',
    );
    expect(dashboardDeltaHelpLines(12, 'files')).toContain(
      '  Default browser mode comes from chat.rendering.diff.turnBrowserMode (files).',
    );
  });
});
