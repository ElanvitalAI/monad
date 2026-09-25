import { describe, expect, test } from 'bun:test';

import { runDashboardSidebarSessionJoin } from '../src/dashboard/sidebar-session-join-runtime.js';

describe('runDashboardSidebarSessionJoin', () => {
  test('formats successful ACP background join results', async () => {
    const events: string[] = [];

    runDashboardSidebarSessionJoin('acp-bg:1', true, {
      dispatchJoin: async () => ({
        promoted: true,
        windowId: 7,
        paneId: 'p3',
        fullOutput: '',
        state: 'running',
      }),
      pushInfo: (message) => { events.push(`info:${message}`); },
      pushError: (message) => { events.push(`error:${message}`); },
      afterSettle: () => { events.push('after'); },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'info:[sidebar · promoted] acp-bg:1 → W7 / p3',
      'after',
    ]);
  });

  test('formats failed ACP background joins', async () => {
    const events: string[] = [];

    runDashboardSidebarSessionJoin('acp-bg:2', false, {
      dispatchJoin: async () => { throw new Error('boom'); },
      pushInfo: (message) => { events.push(`info:${message}`); },
      pushError: (message) => { events.push(`error:${message}`); },
      afterSettle: () => { events.push('after'); },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      'error:[sidebar · join failed] acp-bg:2: boom',
      'after',
    ]);
  });
});
