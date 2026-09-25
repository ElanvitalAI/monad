import { describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { observeDashboardDevRequestRoute } from '../src/dashboard/index.js';
import type { DevRequestRoutingConfig } from '../src/skills/dev-request-router.js';

const enabledConfig: DevRequestRoutingConfig = {
  enabled: true,
  verbs: ['implement'],
  guardKeywords: ['explain'],
};

describe('dashboard development-request observation seam', () => {
  test('the actual dashboard entry seam observes disabled routing before its unchanged continuation', () => {
    const order: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'skills.dev-route') {
        order.push(`${event}:${data?.reason}`);
      }
    }) as never);

    try {
      observeDashboardDevRequestRoute('implement router telemetry', { ...enabledConfig, enabled: false });
      order.push('normal-chat-path');
      expect(order).toEqual(['not-routed:disabled', 'normal-chat-path']);
    } finally {
      log.mockRestore();
    }
  });

  test('the actual dashboard entry seam preserves its continuation when observation logging fails', () => {
    const order: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string) => {
      if (category === 'skills.dev-route') throw new Error('log unavailable');
    }) as never);

    try {
      expect(() => observeDashboardDevRequestRoute('implement router telemetry', enabledConfig)).not.toThrow();
      order.push('normal-chat-path');
      expect(order).toEqual(['normal-chat-path']);
    } finally {
      log.mockRestore();
    }
  });
});
