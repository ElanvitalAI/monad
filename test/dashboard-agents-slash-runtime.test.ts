import { describe, expect, test } from 'bun:test';

import { createDashboardAgentsSlashRuntime } from '../src/dashboard/agents-slash-runtime.js';

describe('createDashboardAgentsSlashRuntime', () => {
  test('renders agents slash feedback lines', () => {
    const runtime = createDashboardAgentsSlashRuntime({
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
    });

    expect(runtime.viewOpenedLine()).toBe('muted:  agents view opened');
    expect(runtime.viewUnavailableLine()).toBe('warning:  agents view is unavailable');
    expect(runtime.popupLine(true)).toBe('muted:  agents companion popup opened');
    expect(runtime.popupLine(false)).toBe('muted:  agents companion popup closed');
    expect(runtime.popupPromotedLine()).toBe('muted:  agents companion promoted to agents view');
    expect(runtime.popupUsageLine()).toBe('warning:  usage: /agents popup [open|close|toggle|promote]');
    expect(runtime.usageLine()).toBe('warning:  Usage: /agents open|popup [open|close|toggle|promote]');
  });
});
