import { describe, expect, test } from 'bun:test';

import { bootDashboardEagerTools } from '../src/dashboard/eager-tool-boot.js';

describe('bootDashboardEagerTools', () => {
  test('runs all initializers and logs failures without aborting the sequence', async () => {
    const events: string[] = [];
    await bootDashboardEagerTools({
      initializers: [
        { label: 'budget', run: () => { events.push('budget'); } },
        { label: 'policy', run: () => { throw new Error('boom'); } },
        { label: 'agent-room', run: async () => { events.push('agent-room'); } },
      ],
      debugLog: (scope, area, details) => {
        events.push(`debug:${scope}:${area}:${details.message}`);
      },
    });

    expect(events).toEqual([
      'budget',
      'debug:policy.init.fail:dashboard-boot:boom',
      'agent-room',
    ]);
  });
});
