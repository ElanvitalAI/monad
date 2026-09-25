// Market holiday tables + marketClock holiday integration.

import { describe, test, expect } from 'bun:test';
import { isUsHoliday, isUsEarlyClose, isKrHoliday, krCalendarCovers } from '../src/domains/market-holidays';
import { marketClock } from '../src/domains/finance';

describe('market-holidays tables', () => {
  test('US full closures (2026 + 2027 samples)', () => {
    expect(isUsHoliday('2026-07-03')).toBe(true);  // Independence Day (observed)
    expect(isUsHoliday('2026-12-25')).toBe(true);  // Christmas
    expect(isUsHoliday('2027-03-26')).toBe(true);  // Good Friday 2027
    expect(isUsHoliday('2026-07-06')).toBe(false); // normal day
  });

  test('US early closes (1pm ET)', () => {
    expect(isUsEarlyClose('2026-11-27')).toBe(true);  // day after Thanksgiving
    expect(isUsEarlyClose('2026-12-24')).toBe(true);  // Christmas Eve
    expect(isUsEarlyClose('2026-11-26')).toBe(false); // Thanksgiving = full close, not early
  });

  test('KR closures incl. lunar + substitute + year-end', () => {
    expect(isKrHoliday('2026-02-17')).toBe(true);  // 설날
    expect(isKrHoliday('2026-09-28')).toBe(true);  // 추석 대체
    expect(isKrHoliday('2026-05-01')).toBe(true);  // 근로자의 날
    expect(isKrHoliday('2026-12-31')).toBe(true);  // 연말 폐장
    expect(isKrHoliday('2026-07-06')).toBe(false); // normal day
  });

  test('krCalendarCovers flags uncovered years', () => {
    expect(krCalendarCovers('2026-03-01')).toBe(true);
    expect(krCalendarCovers('2027-03-01')).toBe(false); // KR 2027 not loaded
  });
});

describe('marketClock — holiday integration', () => {
  test('US holiday during regular hours → CLOSED(휴장) + 휴장 note', () => {
    const s = marketClock(new Date('2026-07-03T14:00:00Z')); // 10:00 ET, July 3
    expect(s).toContain('US CLOSED(휴장)');
    expect(s).toContain('휴장: NYSE');
  });

  test('KR holiday during regular hours → CLOSED(휴장)', () => {
    const s = marketClock(new Date('2026-02-17T01:00:00Z')); // 10:00 KST, 설날
    expect(s).toContain('KR CLOSED(휴장)');
    expect(s).toMatch(/휴장:.*KRX/);
  });

  test('US early-close day, before 1pm → OPEN(조기폐장13:00)', () => {
    const s = marketClock(new Date('2026-11-27T17:00:00Z')); // 12:00 ET
    expect(s).toContain('조기폐장');
  });
});
