import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createControlSignalBus } from '../src/input/control-signal.js';
import { createControlSignalObserver } from '../src/input/control-signal-observer.js';
import { listSimulationScenarios } from '../src/sim/catalog.js';
import { openDashboardLocalSimulationWebCockpit } from '../src/dashboard/sim-web-cockpit-runtime.js';

describe('openDashboardLocalSimulationWebCockpit', () => {
  test('writes a local html cockpit and opens it', async () => {
    const bus = createControlSignalBus(() => '2026-05-01T00:00:00.000Z');
    const observer = createControlSignalObserver(bus);
    bus.emit({
      kind: 'output-sink-stop',
      urgency: 'quick-pass',
      source: { kind: 'keyboard', surface: 'dashboard-chat-main' },
      scope: { surface: 'dashboard-chat-main', channel: 'dashboard' },
      payload: { sinkKind: 'video' },
    });
    let openedPath = '';
    const result = await openDashboardLocalSimulationWebCockpit({
      listScenarios: listSimulationScenarios,
      openTarget: (value) => { openedPath = value; },
      getControlSignalObserver: () => observer,
      getBrowserCdpAvailability: () => ({
        available: false,
        reason: 'no-chrome-binary',
        note: 'Chrome unavailable.',
      }),
    });

    expect(result.scenarioCount).toBeGreaterThan(0);
    expect(result.signalCount).toBe(1);
    expect(result.browserAvailable).toBe(false);
    expect(openedPath).toBe(result.path);

    const html = readFileSync(result.path, 'utf8');
    expect(html).toContain('Simulator + Diagnose Cockpit');
    expect(html).toContain('Local quick-test mode.');
    expect(html).toContain('Production: daemon core exposes the same catalog');
    expect(html).toContain('media-picture-smoke');
    expect(html).toContain('output-sink-stop');
    expect(html).toContain('no-chrome-binary');
  });
});
