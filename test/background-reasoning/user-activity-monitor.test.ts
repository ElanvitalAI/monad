// Y2 user-activity monitor · idle/active threshold + hysteresis + onChange.

import { describe, expect, test } from 'bun:test';
import {
  UserActivityMonitor,
  createOsLoadSampler,
  type CpuSampler,
} from '../../src/background-reasoning/user-activity-monitor';

function fakeSampler(values: number[]): CpuSampler {
  let i = 0;
  return { load: () => values[Math.min(i++, values.length - 1)] ?? 0 };
}

describe('UserActivityMonitor', () => {
  test('starts idle', () => {
    const m = new UserActivityMonitor({ threshold: 0.7, sampler: fakeSampler([0]) });
    expect(m.current()).toBe('idle');
  });

  test('crosses to active when load ≥ threshold', () => {
    const m = new UserActivityMonitor({ threshold: 0.7, sampler: fakeSampler([0.2, 0.8]) });
    expect(m.sample().state).toBe('idle');
    expect(m.sample().state).toBe('active');
  });

  test('hysteresis prevents flapping', () => {
    const m = new UserActivityMonitor({
      threshold: 0.7,
      hysteresis: 0.2,
      sampler: fakeSampler([0.8, 0.6, 0.45]),
    });
    expect(m.sample().state).toBe('active');
    expect(m.sample().state).toBe('active'); // 0.6 < 0.7 but > 0.7-0.2 = 0.5 → stay active
    expect(m.sample().state).toBe('idle');   // 0.45 < 0.5 → drop
  });

  test('onChange fires only on transitions', () => {
    const events: string[] = [];
    const m = new UserActivityMonitor({ threshold: 0.5, sampler: fakeSampler([0.1, 0.2, 0.9, 0.8, 0.1]) });
    m.onChange((s) => events.push(s.state));
    m.sample(); m.sample(); m.sample(); m.sample(); m.sample();
    expect(events).toEqual(['active', 'idle']);
  });

  test('osLoadSampler normalizes against cpu count + clamps', () => {
    const s = createOsLoadSampler({ loadavg: () => [4], cpuCount: () => 8 });
    expect(s.load()).toBeCloseTo(0.5);
    const over = createOsLoadSampler({ loadavg: () => [20], cpuCount: () => 4 });
    expect(over.load()).toBe(1);
    const bad = createOsLoadSampler({ loadavg: () => [-1], cpuCount: () => 1 });
    expect(bad.load()).toBe(0);
  });
});
