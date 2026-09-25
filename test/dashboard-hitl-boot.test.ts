import { describe, expect, test } from 'bun:test';

import { bootDashboardHitl } from '../src/dashboard/hitl-boot.js';

describe('bootDashboardHitl', () => {
  test('does nothing when disabled', () => {
    const events: string[] = [];
    bootDashboardHitl({
      enabled: false,
      initDashboardHitl: async () => { events.push('init'); },
      stopDashboardHitl: async () => { events.push('stop'); },
      debugLog: () => { events.push('debug'); },
      isPushcutConfigured: () => true,
      pushWarningLine: () => { events.push('warn-line'); },
      draw: () => { events.push('draw'); },
      registerBeforeExit: () => { events.push('before-exit'); },
      warnConsole: () => { events.push('console'); },
    });
    expect(events).toEqual([]);
  });

  test('wires init, port shift reporting, and beforeExit cleanup', async () => {
    const events: string[] = [];
    let beforeExit: (() => void) | null = null;
    bootDashboardHitl({
      enabled: true,
      initDashboardHitl: async ({ onPortShift }) => {
        events.push('init');
        onPortShift({ wanted: 17645, actual: 17646 });
      },
      stopDashboardHitl: async () => { events.push('stop'); },
      debugLog: (scope, message) => { events.push(`debug:${scope}:${message}`); },
      isPushcutConfigured: () => true,
      pushWarningLine: (message) => { events.push(`warn:${message}`); },
      draw: () => { events.push('draw'); },
      registerBeforeExit: (cb) => { beforeExit = cb; },
      warnConsole: (message) => { events.push(`console:${message}`); },
    });
    await Promise.resolve();
    beforeExit?.();
    await Promise.resolve();
    expect(events).toEqual([
      'init',
      'debug:hitl.port.shift:17645 → 17646',
      'warn:[hitl] callback port 17645 was busy — bound 17646 instead. Update your Pushcut Shortcut URL: http://127.0.0.1:17646',
      'draw',
      'stop',
    ]);
  });

  test('suppresses chat warning when pushcut is not configured', async () => {
    const events: string[] = [];
    bootDashboardHitl({
      enabled: true,
      initDashboardHitl: async ({ onPortShift }) => {
        onPortShift({ wanted: 17645, actual: 17646 });
      },
      stopDashboardHitl: async () => {},
      debugLog: (scope, message) => { events.push(`debug:${scope}:${message}`); },
      isPushcutConfigured: () => false,
      pushWarningLine: () => { events.push('warn'); },
      draw: () => { events.push('draw'); },
      registerBeforeExit: () => {},
      warnConsole: () => {},
    });
    await Promise.resolve();
    expect(events).toEqual(['debug:hitl.port.shift:17645 → 17646']);
  });
});
