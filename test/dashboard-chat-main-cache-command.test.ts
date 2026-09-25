import { describe, expect, test } from 'bun:test';

import { resolveDashboardChatMainCacheCommand } from '../src/dashboard/input/chat-main-cache-command.js';

describe('dashboard chat main cache command', () => {
  test('defaults to show', () => {
    expect(resolveDashboardChatMainCacheCommand([])).toEqual({ kind: 'show' });
    expect(resolveDashboardChatMainCacheCommand(['show'])).toEqual({ kind: 'show' });
  });

  test('parses reset', () => {
    expect(resolveDashboardChatMainCacheCommand(['reset'])).toEqual({ kind: 'reset' });
  });
});
