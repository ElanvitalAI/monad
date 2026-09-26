import { afterEach, describe, expect, test } from 'bun:test';

import { createDashboardBrowserCdpSlashRuntime } from '../src/dashboard/browser-cdp-slash-runtime.js';
import {
  createControlSignalBus,
  _resetDefaultControlSignalBusForTesting,
} from '../src/input/control-signal.js';

describe('createDashboardBrowserCdpSlashRuntime', () => {
  afterEach(() => {
    _resetDefaultControlSignalBusForTesting();
  });

  test('reports degraded status when Chrome is unavailable', () => {
    const runtime = createDashboardBrowserCdpSlashRuntime({
      accent: (text) => text,
      muted: (text) => text,
      warning: (text) => text,
      getAvailability: () => ({
        available: false,
        reason: 'no-chrome-binary',
        note: 'Chrome unavailable.',
      }),
    });

    expect(runtime.statusLines()).toEqual([
      '  browser-cdp unavailable · no-chrome-binary',
      '  Chrome unavailable.',
    ]);
  });

  test('runs a smoke navigate/read cycle when Chrome is available', async () => {
    const runtime = createDashboardBrowserCdpSlashRuntime({
      accent: (text) => text,
      muted: (text) => text,
      warning: (text) => text,
      getAvailability: () => ({
        available: true,
        reason: 'ok',
        note: 'Chrome available.',
        binary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      }),
      navigate: async () => ({
        output: 'ok',
        finalUrl: 'data:text/html,smoke',
        title: 'Elanous Browser CDP Smoke',
        loadMs: 5,
      }),
      read: async ({ mode }) => {
        if (mode === 'screenshot') {
          return {
            output: 'shot',
            mode: 'screenshot',
            screenshotBase64: Buffer.from('png').toString('base64'),
          };
        }
        return {
          output: 'text',
          mode: 'text',
          text: 'browser runtime smoke ok',
        };
      },
    });

    const lines = await runtime.smokeLines();
    expect(lines).toEqual([
      '  browser-cdp smoke: ok',
      '  navigate: Elanous Browser CDP Smoke · data:text/html,smoke',
      '  text: browser runtime smoke ok',
      '  screenshot bytes: 3',
    ]);
  });

  test('emits browser-cdp-stop on the control bus', () => {
    const bus = createControlSignalBus(() => '2026-05-01T00:00:00.000Z');
    const runtime = createDashboardBrowserCdpSlashRuntime({
      accent: (text) => text,
      muted: (text) => text,
      warning: (text) => text,
      signalBus: bus,
    });
    expect(runtime.stopLines()).toEqual([
      '  emitted browser-cdp-stop · quick-pass · surface=browser · channel=dashboard',
    ]);
    expect(bus.list({ kind: 'browser-cdp-stop' })).toHaveLength(1);
  });
});
