// Phase 2 D1 — TimeSlotManager unit tests.

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_POLICY,
  parseClock,
  rangeFromText,
  TimeSlotManager,
  type LearnedFallback,
} from '../../src/dispatch/time-slot.ts';

function at(hh: number, mm = 0): Date {
  const d = new Date(2026, 4, 12, hh, mm, 0, 0);
  return d;
}

describe('parseClock', () => {
  test('accepts HH:MM with 1- or 2-digit hour', () => {
    expect(parseClock('09:30')).toBe(9 * 60 + 30);
    expect(parseClock('9:30')).toBe(9 * 60 + 30);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    expect(parseClock('00:00')).toBe(0);
  });

  test('rejects malformed / out-of-range strings', () => {
    expect(() => parseClock('25:00')).toThrow(/out-of-range/);
    expect(() => parseClock('12')).toThrow(/invalid clock/);
    expect(() => parseClock('aa:bb')).toThrow(/invalid clock/);
  });
});

describe('rangeFromText', () => {
  test('builds a same-day range', () => {
    const r = rangeFromText('09:00-12:00', 'focused-work');
    expect(r.startMin).toBe(9 * 60);
    expect(r.endMin).toBe(12 * 60);
    expect(r.kind).toBe('focused-work');
  });

  test('wraps past midnight when end ≤ start', () => {
    const r = rangeFromText('23:00-07:00', 'sleep');
    expect(r.startMin).toBe(23 * 60);
    expect(r.endMin).toBe((24 + 7) * 60);
  });

  test('overlays partial policy', () => {
    const r = rangeFromText('00:00-07:00', 'sleep', { apiCost: 'allow' });
    expect(r.policy?.apiCost).toBe('allow');
  });
});

describe('TimeSlotManager.currentSlot', () => {
  test('falls back to defaultKind when no ranges + no fallback', () => {
    const mgr = new TimeSlotManager({ now: () => at(10) });
    const slot = mgr.currentSlot();
    expect(slot.kind).toBe('active');
    expect(slot.fromFallback).toBe(false);
    expect(slot.range).toBeUndefined();
    expect(slot.policy).toEqual(DEFAULT_POLICY.active);
  });

  test('matches a user-explicit range', () => {
    const mgr = new TimeSlotManager({
      ranges: [rangeFromText('09:00-12:00', 'focused-work')],
      now: () => at(10, 30),
    });
    const slot = mgr.currentSlot();
    expect(slot.kind).toBe('focused-work');
    expect(slot.range).toBeDefined();
    expect(slot.policy.noisyTasks).toBe('deny');
  });

  test('higher-index range wins on overlap', () => {
    const mgr = new TimeSlotManager({
      ranges: [
        rangeFromText('00:00-23:59', 'active'),
        rangeFromText('09:00-12:00', 'focused-work'),
      ],
      now: () => at(10),
    });
    expect(mgr.currentSlot().kind).toBe('focused-work');
  });

  test('honours wrap-around ranges (sleep window 23:00-07:00)', () => {
    const mgr = new TimeSlotManager({
      ranges: [rangeFromText('23:00-07:00', 'sleep')],
    });
    expect(mgr.currentSlot(at(2, 30)).kind).toBe('sleep');
    expect(mgr.currentSlot(at(23, 30)).kind).toBe('sleep');
    expect(mgr.currentSlot(at(8, 0)).kind).toBe('active');
  });

  test('range policy override is applied on top of default policy', () => {
    const mgr = new TimeSlotManager({
      ranges: [rangeFromText('00:00-07:00', 'sleep', { apiCost: 'allow' })],
      now: () => at(3),
    });
    const slot = mgr.currentSlot();
    expect(slot.policy.apiCost).toBe('allow');
    expect(slot.policy.pushFreq).toBe('suppress'); // inherited from default
  });
});

describe('LearnedFallback wiring (D2 preview)', () => {
  const fallback: LearnedFallback = {
    inferKind(modMin) {
      if (modMin >= 0 * 60 && modMin < 7 * 60) return 'sleep';
      if (modMin >= 22 * 60) return 'sleep';
      return null;
    },
  };

  test('used when no user range matches', () => {
    const mgr = new TimeSlotManager({ fallback, now: () => at(3) });
    const slot = mgr.currentSlot();
    expect(slot.kind).toBe('sleep');
    expect(slot.fromFallback).toBe(true);
  });

  test('explicit ranges still take precedence over fallback', () => {
    const mgr = new TimeSlotManager({
      ranges: [rangeFromText('00:00-07:00', 'active')],
      fallback,
      now: () => at(3),
    });
    expect(mgr.currentSlot().kind).toBe('active');
  });

  test('falls through to defaultKind when fallback returns null', () => {
    const mgr = new TimeSlotManager({ fallback, now: () => at(12) });
    expect(mgr.currentSlot().kind).toBe('active');
  });
});

describe('isInSlot helper', () => {
  test('checks the resolved kind', () => {
    const mgr = new TimeSlotManager({
      ranges: [rangeFromText('09:00-12:00', 'focused-work')],
      now: () => at(10),
    });
    expect(mgr.isInSlot('focused-work')).toBe(true);
    expect(mgr.isInSlot('idle')).toBe(false);
  });
});

describe('listRanges introspection', () => {
  test('returns config in caller order', () => {
    const r1 = rangeFromText('00:00-07:00', 'sleep');
    const r2 = rangeFromText('09:00-12:00', 'focused-work');
    const mgr = new TimeSlotManager({ ranges: [r1, r2] });
    expect(mgr.listRanges()).toEqual([r1, r2]);
  });
});
