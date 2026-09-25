import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainThemeCommand } from '../src/dashboard/input/chat-main-theme-command.js';

describe('dashboard chat main theme command', () => {
  test('parses known subcommands', () => {
    expect(resolveDashboardChatMainThemeCommand(['list'])).toEqual({ kind: 'list' });
    expect(resolveDashboardChatMainThemeCommand(['switch', 'rose-pine-dawn'])).toEqual({
      kind: 'switch',
      name: 'rose-pine-dawn',
    });
    expect(resolveDashboardChatMainThemeCommand(['use', 'plugin:x.y'])).toEqual({
      kind: 'use',
      id: 'plugin:x.y',
    });
    expect(resolveDashboardChatMainThemeCommand(['reset'])).toEqual({ kind: 'reset' });
    expect(resolveDashboardChatMainThemeCommand([])).toEqual({ kind: 'preview', mode: 'preview' });
    expect(resolveDashboardChatMainThemeCommand(['export'])).toEqual({ kind: 'preview', mode: 'export' });
  });

  test('preserves unknown subcommands', () => {
    expect(resolveDashboardChatMainThemeCommand(['wat'])).toEqual({
      kind: 'unknown',
      subcommand: 'wat',
    });
  });
});
