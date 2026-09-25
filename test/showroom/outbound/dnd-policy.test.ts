// W7 Z11.a-1 · DnD windows + urgency pierce.

import { describe, expect, test } from 'bun:test';
import { isMuted, type DndPolicy } from '../../../src/showroom/outbound/dnd-policy';

function policy(over: Partial<DndPolicy> = {}): DndPolicy {
  return { windows: [], ...over };
}

describe('isMuted', () => {
  test('returns false when no windows defined', () => {
    expect(isMuted(policy(), 'ios-push', 'normal')).toBe(false);
  });

  test('mutes channel within a basic window', () => {
    const p = policy({
      windows: [{ startHour: 22, endHour: 7 }],
      now: () => new Date(2026, 4, 12, 23, 0),
    });
    expect(isMuted(p, 'ios-push', 'normal')).toBe(true);
  });

  test('does not mute outside the window', () => {
    const p = policy({
      windows: [{ startHour: 22, endHour: 7 }],
      now: () => new Date(2026, 4, 12, 14, 0),
    });
    expect(isMuted(p, 'ios-push', 'normal')).toBe(false);
  });

  test('critical urgency pierces by default', () => {
    const p = policy({
      windows: [{ startHour: 22, endHour: 7 }],
      now: () => new Date(2026, 4, 12, 23, 0),
    });
    expect(isMuted(p, 'ios-push', 'critical')).toBe(false);
  });

  test('explicit pierceAt overrides default', () => {
    const p = policy({
      windows: [{ startHour: 22, endHour: 7, pierceAt: 'normal' }],
      now: () => new Date(2026, 4, 12, 23, 0),
    });
    expect(isMuted(p, 'ios-push', 'low')).toBe(true);
    expect(isMuted(p, 'ios-push', 'normal')).toBe(false);
  });

  test('channel filter applies per window', () => {
    const p = policy({
      windows: [{ startHour: 0, endHour: 24, channels: ['live-activity'] }],
      now: () => new Date(2026, 4, 12, 10, 0),
    });
    expect(isMuted(p, 'live-activity', 'normal')).toBe(true);
    expect(isMuted(p, 'ios-push', 'normal')).toBe(false);
  });

  test('day filter applies', () => {
    const p = policy({
      windows: [{ startHour: 0, endHour: 24, days: [1, 2, 3] }],
      now: () => new Date(2026, 4, 9, 10, 0), // Saturday
    });
    expect(isMuted(p, 'ios-push', 'normal')).toBe(false);
  });
});
