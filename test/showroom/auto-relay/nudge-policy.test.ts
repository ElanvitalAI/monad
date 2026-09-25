// W9b Z7 · nudge-policy threshold + quiet hours + rate limit.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_NUDGE_THRESHOLDS,
  DEFAULT_QUIET_HOURS,
  evaluateNudge,
  type IdleTaskObservation,
  type NudgeHistory,
  type NudgePolicyOpts,
} from '../../../src/showroom/auto-relay/nudge-policy';

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

function obs(status: IdleTaskObservation['status'], idleHours: number, atUtc = '2026-05-12T13:00:00Z'): IdleTaskObservation {
  const observedAt = new Date(atUtc).getTime();
  return {
    taskId: 't-1',
    status,
    observedAt,
    enteredStatusAt: observedAt - idleHours * HOUR,
  };
}

const noHistory: NudgeHistory = { recentNudgesAt: [] };

const FORCE_OPEN_QUIET: NudgePolicyOpts = {
  quietHours: { ...DEFAULT_QUIET_HOURS, startHour: 0, endHour: 23 },
};

describe('evaluateNudge · threshold', () => {
  test('review under 24h is still-fresh', () => {
    const d = evaluateNudge(obs('review', 12), noHistory, FORCE_OPEN_QUIET);
    expect(d.kind).toBe('skip');
    if (d.kind === 'skip') expect(d.reason).toBe('still-fresh');
  });

  test('review over 24h fires nudge with idleMs payload', () => {
    const d = evaluateNudge(obs('review', 25), noHistory, FORCE_OPEN_QUIET);
    expect(d.kind).toBe('nudge');
    if (d.kind === 'nudge') {
      expect(d.status).toBe('review');
      expect(d.idleMs).toBeGreaterThan(24 * HOUR);
    }
  });

  test('ready threshold defaults to 72h', () => {
    expect(evaluateNudge(obs('ready', 71), noHistory, FORCE_OPEN_QUIET).kind).toBe('skip');
    expect(evaluateNudge(obs('ready', 73), noHistory, FORCE_OPEN_QUIET).kind).toBe('nudge');
  });

  test('blocked threshold defaults to 7 days', () => {
    expect(evaluateNudge(obs('blocked', 24 * 6), noHistory, FORCE_OPEN_QUIET).kind).toBe('skip');
    expect(evaluateNudge(obs('blocked', 24 * 8), noHistory, FORCE_OPEN_QUIET).kind).toBe('nudge');
  });

  test('threshold override', () => {
    const d = evaluateNudge(
      obs('review', 2),
      noHistory,
      { ...FORCE_OPEN_QUIET, thresholds: { review: HOUR } },
    );
    expect(d.kind).toBe('nudge');
  });

  test('unknown status returns skip', () => {
    const bad = { ...obs('review', 50), status: 'mystery' as IdleTaskObservation['status'] };
    const d = evaluateNudge(bad, noHistory, FORCE_OPEN_QUIET);
    expect(d.kind).toBe('skip');
    if (d.kind === 'skip') expect(d.reason).toBe('unknown-status');
  });
});

describe('evaluateNudge · quiet hours', () => {
  test('defers outside 09-22 UTC window with nextEligibleAt set', () => {
    // Observation at 03:00 UTC (default quiet hours = 09-22 UTC).
    const d = evaluateNudge(obs('review', 50, '2026-05-12T03:00:00Z'), noHistory);
    expect(d.kind).toBe('defer');
    if (d.kind === 'defer') {
      expect(d.nextEligibleAt).toBeGreaterThan(new Date('2026-05-12T03:00:00Z').getTime());
    }
  });

  test('respects positive tz offset (KST = +540)', () => {
    // 03:00 UTC + 540m = 12:00 KST. Inside the default 09-22 quiet window
    // when interpreted as local hours.
    const d = evaluateNudge(
      obs('review', 50, '2026-05-12T03:00:00Z'),
      noHistory,
      { quietHours: { startHour: 9, endHour: 22, tzOffsetMinutes: 540 } },
    );
    expect(d.kind).toBe('nudge');
  });

  test('respects wrap-around window (22..7)', () => {
    // At 04:00 UTC, the 22..7 window is open.
    const d = evaluateNudge(
      obs('review', 50, '2026-05-12T04:00:00Z'),
      noHistory,
      { quietHours: { startHour: 22, endHour: 7, tzOffsetMinutes: 0 } },
    );
    expect(d.kind).toBe('nudge');
  });
});

describe('evaluateNudge · rate limit', () => {
  test('rejects when previous nudge was within minIntervalMs', () => {
    const now = new Date('2026-05-12T13:00:00Z').getTime();
    const history: NudgeHistory = { recentNudgesAt: [now - 2 * HOUR] };
    const d = evaluateNudge(obs('review', 50), history, FORCE_OPEN_QUIET);
    expect(d.kind).toBe('skip');
    if (d.kind === 'skip') expect(d.reason).toBe('rate-limited');
  });

  test('passes when previous nudge was over minIntervalMs ago', () => {
    const now = new Date('2026-05-12T13:00:00Z').getTime();
    const history: NudgeHistory = { recentNudgesAt: [now - 13 * HOUR] };
    const d = evaluateNudge(obs('review', 50), history, FORCE_OPEN_QUIET);
    expect(d.kind).toBe('nudge');
  });

  test('caps total per 24h', () => {
    const now = new Date('2026-05-12T13:00:00Z').getTime();
    const history: NudgeHistory = {
      recentNudgesAt: [now - 13 * HOUR, now - 20 * HOUR],
    };
    const d = evaluateNudge(obs('review', 50), history, {
      ...FORCE_OPEN_QUIET,
      rateLimit: { minIntervalMs: 0, maxPerDay: 2 },
    });
    expect(d.kind).toBe('skip');
    if (d.kind === 'skip') expect(d.reason).toBe('rate-limited');
  });

  test('older nudges (>24h) do not count toward daily cap', () => {
    const now = new Date('2026-05-12T13:00:00Z').getTime();
    const history: NudgeHistory = {
      recentNudgesAt: [now - 25 * HOUR, now - 30 * HOUR],
    };
    const d = evaluateNudge(obs('review', 50), history, {
      ...FORCE_OPEN_QUIET,
      rateLimit: { minIntervalMs: 0, maxPerDay: 2 },
    });
    expect(d.kind).toBe('nudge');
  });
});

describe('DEFAULT_NUDGE_THRESHOLDS', () => {
  test('matches S7 spec', () => {
    expect(DEFAULT_NUDGE_THRESHOLDS.review).toBe(24 * HOUR);
    expect(DEFAULT_NUDGE_THRESHOLDS.ready).toBe(72 * HOUR);
    expect(DEFAULT_NUDGE_THRESHOLDS.blocked).toBe(7 * DAY);
  });
});
