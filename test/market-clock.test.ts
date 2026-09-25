// Session-aware market clock — the ambient context injected fresh every
// finance turn. Pure (injected Date), so session windows + the data-freshness
// directive are guarded here.

import { describe, test, expect } from 'bun:test';
import { marketClock } from '../src/domains/finance';

// Helpers pick a UTC instant that maps to a known ET/KST wall-clock. All on a
// weekday (2026-07-06 is a Monday).
const at = (utc: string) => marketClock(new Date(utc));

describe('marketClock — session detection', () => {
  test('US regular (10:00 ET) → US OPEN + real-time directive', () => {
    const s = at('2026-07-06T14:00:00Z'); // 10:00 ET
    expect(s).toContain('US OPEN');
    expect(s).toMatch(/실시간 시세/);
    expect(s).toMatch(/현재가\/등락 기준으로 답/);
    expect(s).toMatch(/종가\(EOD\)만 쓰면 밝힐 것/);
  });

  test('US pre-market (08:00 ET) → US PRE', () => {
    expect(at('2026-07-06T12:00:00Z')).toContain('US PRE');
  });

  test('US after-hours (17:00 ET) → US AFTER + live directive', () => {
    const s = at('2026-07-06T21:00:00Z');
    expect(s).toContain('US AFTER');
    expect(s).toMatch(/실시간 시세/);
  });

  test('KR regular (10:00 KST) → KR OPEN + KODEX OPEN', () => {
    const s = at('2026-07-06T01:00:00Z'); // 10:00 KST
    expect(s).toContain('KR OPEN');
    expect(s).toContain('KODEX(KRX)=OPEN');
  });

  test('KR NXT pre (08:30 KST) → NXT프리 tradeable + overnight-US context recipe', () => {
    const s = at('2026-07-05T23:30:00Z'); // 08:30 KST Mon
    expect(s).toContain('KR NXT프리');
    expect(s).toContain('NXT 매매가능');
    expect(s).toMatch(/컨텍스트:/);
    expect(s).toMatch(/밤사이 US|US 선물|USDKRW/); // overnight handoff recipe
  });

  test('KR NXT after (17:00 KST) → NXT애프터 tradeable', () => {
    const s = at('2026-07-06T08:00:00Z'); // 17:00 KST Mon
    expect(s).toContain('KR NXT애프터');
    expect(s).toContain('NXT 매매가능');
  });

  test('KR 종가매매 (15:45 KST) → tradeable', () => {
    const s = at('2026-07-06T06:45:00Z'); // 15:45 KST
    expect(s).toContain('KR 종가매매');
    expect(s).toContain('NXT 매매가능');
  });

  test('KR 장전동시호가 (08:55 KST) → order-entry only (no 매매가능 flag)', () => {
    const s = at('2026-07-05T23:55:00Z'); // 08:55 KST
    expect(s).toContain('KR 장전동시호가');
    expect(s).not.toContain('매매가능'); // auction order entry, not continuous execution
  });

  test('context recipe leads with the dominant live session (US OPEN)', () => {
    const s = at('2026-07-06T14:00:00Z'); // 10:00 ET
    expect(s).toMatch(/컨텍스트: 미국 정규장/);
    expect(s).toMatch(/한국물|ADR/);
  });

  test('all closed (weekend) → EOD directive, no live push', () => {
    const s = at('2026-07-05T14:00:00Z'); // Sunday
    expect(s).toContain('KR CLOSED');
    expect(s).toContain('US CLOSED');
    expect(s).toMatch(/마지막 종가|EOD/);
    expect(s).toMatch(/장 마감/);
  });

  test('always carries the KST/ET clock + holiday caveat', () => {
    const s = at('2026-07-06T14:00:00Z');
    expect(s).toContain('KST');
    expect(s).toContain('ET');
    expect(s).toMatch(/휴장 캘린더 반영/);
  });
});
