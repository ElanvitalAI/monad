import { describe, expect, test } from 'bun:test';

import { createControlSignalBus } from '../src/input/control-signal.js';
import {
  listDashboardSimulationScenarios,
  runDashboardSimulationScenario,
} from '../src/dashboard/sim-shell-runtime.js';

describe('dashboard sim shell runtime', () => {
  test('exposes initial media and browser scenarios', () => {
    const scenarios = listDashboardSimulationScenarios();
    const ids = scenarios.map((item) => item.id);
    expect(ids).toEqual([
      'media-picture-smoke',
      'media-video-stop-gate',
      'browser-cdp-status',
      'browser-cdp-smoke',
      'browser-cdp-stop',
    ]);
    expect(scenarios[0]?.targets).toEqual(['dashboard', 'pwa']);
    expect(scenarios[0]?.prerequisites.length).toBeGreaterThan(0);
  });

  test('media video stop gate seeds, opens, signals, then reopens', async () => {
    const events: string[] = [];
    const bus = createControlSignalBus();
    const result = await runDashboardSimulationScenario('media-video-stop-gate', {
      seedAssistantSample: (text) => { events.push(`seed:${text.slice(0, 24)}`); },
      clearAssistantSample: () => { events.push('clear'); },
      openLastAssistantMediaPreview: async () => { events.push('open'); },
      getBrowserStatusLines: () => ['status'],
      getBrowserSmokeLines: async () => ['smoke'],
      getBrowserStopLines: () => ['stop'],
      signalBus: bus,
      signalScope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      source: { kind: 'keyboard', surface: 'dashboard-chat-main' },
    });

    expect(events).toEqual([
      expect.stringContaining('seed:['),
      'open',
      'open',
    ]);
    expect(result.lines).toContain('emitted output-sink-stop for video sink');
    expect(result.observedAt).toMatch(/T/);
    expect(bus.list({ kind: 'output-sink-stop' })).toHaveLength(1);
  });

  test('browser status delegates through provided lines', async () => {
    const result = await runDashboardSimulationScenario('browser-cdp-status', {
      seedAssistantSample: () => {},
      clearAssistantSample: () => {},
      openLastAssistantMediaPreview: async () => {},
      getBrowserStatusLines: () => ['available'],
      getBrowserSmokeLines: async () => ['smoke'],
      getBrowserStopLines: () => ['stop'],
    });
    expect(result.lines).toEqual(['available']);
    expect(result.observedAt).toMatch(/T/);
  });
});
