// H6 P1 Bundle 2 · forecaster tests.

import { describe, test, expect } from 'bun:test';
import { forecastWindow, forecastSnapshot, toUsagePace } from '../../src/budget/forecaster';
import type { RateWindow, UsageSnapshot } from '../../src/budget/types';

const HOUR = 60 * 60 * 1000;

function makeWindow(overrides: Partial<RateWindow> = {}): RateWindow {
  return {
    kind: 'session',
    windowMinutes: 300,
    limit: 100,
    used: 50,
    remainingPercent: 50,
    resetsAt: 1_000_000_000,
    ...overrides,
  };
}

describe('forecastWindow · recommendation buckets', () => {
  test('safe bucket for low usage', () => {
    const now = 1_000_000_000 - 2 * HOUR;
    const f = forecastWindow(makeWindow({ used: 30 }), { now: () => now });
    expect(f?.recommendation).toBe('safe');
  });

  test('warn bucket at 80%', () => {
    const now = 1_000_000_000 - 1 * HOUR;
    const f = forecastWindow(makeWindow({ used: 85 }), { now: () => now });
    expect(f?.recommendation).toBe('warn');
  });

  test('throttle bucket at 95%+', () => {
    const now = 1_000_000_000 - 1 * HOUR;
    const f = forecastWindow(makeWindow({ used: 98 }), { now: () => now });
    expect(f?.recommendation).toBe('throttle');
  });

  test('custom thresholds', () => {
    const now = 1_000_000_000 - 1 * HOUR;
    const f = forecastWindow(makeWindow({ used: 50 }), {
      now: () => now,
      warnAt: 40,
      throttleAt: 45,
    });
    expect(f?.recommendation).toBe('throttle');
  });
});

describe('forecastWindow · pace projection', () => {
  test('projects arrival when pacing above expected', () => {
    // Window 5h (300min), now at 1h in → elapsed 20%, used 40%
    // paceRatio = 2 → projected total = 200%, ETA = 2.5h from windowStart
    const durationMs = 300 * 60 * 1000;
    const resetsAt = 10_000_000_000;
    const windowStart = resetsAt - durationMs;
    const now = windowStart + HOUR;
    const f = forecastWindow(
      makeWindow({ resetsAt, used: 40 }),
      { now: () => now },
    );
    expect(f?.atCurrentPaceReachesLimitAt).not.toBeNull();
    expect(f!.atCurrentPaceReachesLimitAt!).toBeGreaterThan(now);
    expect(f!.atCurrentPaceReachesLimitAt!).toBeLessThan(resetsAt);
  });

  test('no projection when pacing below expected', () => {
    const durationMs = 300 * 60 * 1000;
    const resetsAt = 10_000_000_000;
    const windowStart = resetsAt - durationMs;
    // Halfway through window, only 20% used → paceRatio = 0.4
    const now = windowStart + durationMs / 2;
    const f = forecastWindow(
      makeWindow({ resetsAt, used: 20 }),
      { now: () => now },
    );
    expect(f?.atCurrentPaceReachesLimitAt).toBeNull();
  });

  test('already at 100% → eta is now', () => {
    const now = 500_000;
    const f = forecastWindow(
      makeWindow({ resetsAt: 1_000_000, used: 100 }),
      { now: () => now },
    );
    expect(f?.atCurrentPaceReachesLimitAt).toBe(now);
  });

  test('returns null when resetsAt is missing', () => {
    const f = forecastWindow(makeWindow({ resetsAt: 0 }));
    expect(f).toBeNull();
  });

  test('returns null when windowMinutes is zero', () => {
    const f = forecastWindow(makeWindow({ windowMinutes: 0 }));
    expect(f).toBeNull();
  });
});

describe('forecastSnapshot', () => {
  test('forecasts every window in the snapshot', () => {
    const snap: UsageSnapshot = {
      provider: 'claude',
      windows: [
        makeWindow({ kind: 'session', resetsAt: 10_000_000 }),
        makeWindow({ kind: 'weekly', resetsAt: 10_000_000, windowMinutes: 7 * 24 * 60, used: 75 }),
      ],
      fetchedAt: 0,
      source: 'oauth-api',
    };
    const now = 10_000_000 - HOUR;
    const forecasts = forecastSnapshot(snap, { now: () => now });
    expect(forecasts.length).toBe(2);
    expect(forecasts[0]?.windowKind).toBe('session');
    expect(forecasts[1]?.windowKind).toBe('weekly');
  });

  test('skips windows that cannot be forecasted', () => {
    const snap: UsageSnapshot = {
      provider: 'claude',
      windows: [
        makeWindow({ resetsAt: 0 }),
        makeWindow({ resetsAt: 10_000_000 }),
      ],
      fetchedAt: 0,
      source: 'oauth-api',
    };
    expect(forecastSnapshot(snap, { now: () => 10_000_000 - HOUR }).length).toBe(1);
  });
});

describe('toUsagePace', () => {
  test('converts ForecastResult to UsagePace shape', () => {
    const now = 1_000_000 - HOUR;
    const f = forecastWindow(makeWindow({ resetsAt: 1_000_000, used: 50 }), { now: () => now });
    expect(f).not.toBeNull();
    const pace = toUsagePace(f!);
    expect(pace.windowKind).toBe('session');
    expect(pace.usedPercent).toBe(50);
  });
});
