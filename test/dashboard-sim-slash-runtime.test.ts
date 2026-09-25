import { describe, expect, test } from 'bun:test';

import { createDashboardSimSlashRuntime } from '../src/dashboard/sim-slash-runtime.js';
import { listDashboardSimulationScenarios } from '../src/dashboard/sim-shell-runtime.js';

describe('createDashboardSimSlashRuntime', () => {
  test('builds usage, list, and action lines', () => {
    const runtime = createDashboardSimSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
    });

    const usage = runtime.usageLines();
    const list = runtime.listLines(listDashboardSimulationScenarios());

    expect(usage[1]).toBe('accent:❯ /sim');
    expect(usage.some((line) => line.includes('/sim web'))).toBe(true);
    expect(usage.some((line) => line.includes('/sim run <scenario>'))).toBe(true);
    expect(list[0]).toBe('accent:❯ /sim list');
    expect(list.some((line) => line.includes('media-picture-smoke'))).toBe(true);
    expect(runtime.openedLine(7)).toBe('muted:  opened simulator shell in win:7');
    expect(runtime.openedWebLine('/tmp/sim/index.html')).toBe('muted:  opened local simulator web cockpit: /tmp/sim/index.html');
    expect(runtime.runHeading('media-picture-smoke')).toBe('accent:❯ /sim run media-picture-smoke');
    expect(runtime.unknownScenarioLine('zzz')).toBe('warning:  unknown simulator scenario: zzz');
  });
});
