import { describe, expect, test } from 'bun:test';

import { bootDashboardAcpBgSweep } from '../src/dashboard/acp-bg-sweep-boot.js';

describe('bootDashboardAcpBgSweep', () => {
  test('starts auto sweep with default cadence when enabled', () => {
    const calls: Array<{ intervalMs: number; olderThanMs: number }> = [];
    bootDashboardAcpBgSweep({
      enabled: true,
      backgroundManager: {
        startAutoSweep: (opts) => {
          calls.push(opts);
          return () => {};
        },
      },
    });
    expect(calls).toEqual([{
      intervalMs: 60 * 60 * 1000,
      olderThanMs: 24 * 60 * 60 * 1000,
    }]);
  });

  test('does nothing when disabled', () => {
    const calls: Array<{ intervalMs: number; olderThanMs: number }> = [];
    bootDashboardAcpBgSweep({
      enabled: false,
      backgroundManager: {
        startAutoSweep: (opts) => {
          calls.push(opts);
          return () => {};
        },
      },
    });
    expect(calls).toEqual([]);
  });
});
